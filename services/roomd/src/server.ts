#!/usr/bin/env node
import cors from "cors";
import express from "express";
import {
  CompleteRequestParamsSchema,
  GetPromptRequestParamsSchema,
  SubscribeRequestParamsSchema,
  UnsubscribeRequestParamsSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { RealMcpSessionFactory } from "./mcp";
import {
  commandEnvelopeSchema,
  createRoomSchema,
  inspectServerSchema,
  sinceRevisionSchema,
} from "./schema";
import { invalidPayloadError, mapUnknownError } from "./errors";
import { RoomStore } from "./store";
import { ClientCapabilityRegistry } from "./client-capabilities/registry";
import { registerInstanceRoutes } from "./server-instance-routes";
import type { HttpAuthStrategyConfig } from "./types";
import {
  resolveRemoteHttpOriginAllowlist,
  resolveStdioAllowlist,
} from "./dev-security-overrides";

const port = Number.parseInt(process.env.ROOMD_PORT ?? "8090", 10);
const eventWindowSize = Number.parseInt(
  process.env.ROOMD_EVENT_WINDOW ?? "500",
  10,
);
const invocationHistoryLimit = Number.parseInt(
  process.env.ROOMD_INVOCATION_HISTORY_LIMIT ?? "200",
  10,
);
const idempotencyKeyLimit = Number.parseInt(
  process.env.ROOMD_IDEMPOTENCY_LIMIT ?? "1000",
  10,
);
const serverAllowlist = parseCommaList(process.env.ROOMD_SERVER_ALLOWLIST);
const dangerouslyAllowStdio = parseBoolean(
  process.env.DANGEROUSLY_ALLOW_STDIO,
);
const configuredStdioCommandAllowlist = parseCommaList(
  process.env.ROOMD_STDIO_COMMAND_ALLOWLIST,
);
const stdioCommandAllowlist = resolveStdioAllowlist(
  configuredStdioCommandAllowlist,
  dangerouslyAllowStdio,
);
const dangerouslyAllowRemoteHttp = parseBoolean(
  process.env.DANGEROUSLY_ALLOW_REMOTE_HTTP,
);
const allowRemoteHttpServers = dangerouslyAllowRemoteHttp || parseBoolean(
  process.env.ROOMD_ALLOW_REMOTE_HTTP_SERVERS,
);
const configuredRemoteHttpOriginAllowlist = parseCommaList(
  process.env.ROOMD_REMOTE_HTTP_ORIGIN_ALLOWLIST,
);
const remoteHttpOriginAllowlist = resolveRemoteHttpOriginAllowlist(
  configuredRemoteHttpOriginAllowlist,
  dangerouslyAllowRemoteHttp,
);
const httpAuthConfig = parseHttpAuthConfig(process.env.ROOMD_HTTP_AUTH_CONFIG);
const clientCapabilityRegistry = new ClientCapabilityRegistry();

const store = new RoomStore(
  new RealMcpSessionFactory({
    stdioCommandAllowlist,
    httpAuthConfig,
    clientCapabilityRegistry,
  }),
  {
    eventWindowSize,
    invocationHistoryLimit,
    idempotencyKeyLimit,
    serverAllowlist,
    stdioCommandAllowlist,
    allowRemoteHttpServers,
    remoteHttpOriginAllowlist,
    clientCapabilityRegistry,
  },
);

for (const roomId of parseCommaList(process.env.ROOMD_BOOTSTRAP_ROOMS)) {
  if (!store.hasRoom(roomId)) {
    store.createRoom(roomId);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/rooms", (req, res, next) => {
  try {
    const { roomId } = createRoomSchema.parse(req.body);
    const state = store.createRoom(roomId);
    res.status(201).json({ ok: true, state });
  } catch (error) {
    next(error);
  }
});

app.get("/rooms/:roomId/state", (req, res, next) => {
  try {
    const state = store.getState(req.params.roomId);
    res.json({ ok: true, revision: state.revision, state });
  } catch (error) {
    next(error);
  }
});

app.get("/rooms/:roomId/events", (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const sinceRevision = parseSinceRevision(req.query.sinceRevision, req.header("last-event-id"));
    const replay = store.getReplayEvents(roomId, sinceRevision);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for (const event of replay) {
      writeSseEvent(res, event);
    }

    const unsubscribe = store.subscribe(roomId, (event) => {
      writeSseEvent(res, event);
    });

    const heartbeat = setInterval(() => {
      res.write(`: keep-alive ${Date.now()}\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (error) {
    next(error);
  }
});

app.post("/rooms/:roomId/commands", async (req, res, next) => {
  try {
    const roomId = req.params.roomId;
    const envelope = commandEnvelopeSchema.parse(req.body);
    const result = await store.applyCommand(roomId, envelope);
    res.status(result.statusCode).json(result.response);
  } catch (error) {
    next(error);
  }
});

app.post("/inspect/server", async (req, res, next) => {
  try {
    const { server } = inspectServerSchema.parse(req.body);
    const inspection = await store.inspectServer(server);
    res.json({ ok: true, ...inspection });
  } catch (error) {
    next(error);
  }
});

registerInstanceRoutes(app, store, {
  getPromptRequestParamsSchema: GetPromptRequestParamsSchema,
  completeRequestParamsSchema: CompleteRequestParamsSchema,
  subscribeRequestParamsSchema: SubscribeRequestParamsSchema,
  unsubscribeRequestParamsSchema: UnsubscribeRequestParamsSchema,
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const mapped = error instanceof z.ZodError
    ? invalidPayloadError({ issues: error.issues })
    : mapUnknownError(error);
  res.status(mapped.statusCode).json(mapped.toResponseBody());
});

app.listen(port, () => {
  console.log(`[roomd] listening on http://localhost:${port}`);
  if (dangerouslyAllowStdio) {
    console.warn(
      "[roomd] WARNING: DANGEROUSLY_ALLOW_STDIO enabled (defaulting empty stdio allowlist to *).",
    );
  }
  if (dangerouslyAllowRemoteHttp) {
    console.warn(
      "[roomd] WARNING: DANGEROUSLY_ALLOW_REMOTE_HTTP enabled (remote HTTP + origin wildcard allowed when unset).",
    );
  }
  if (serverAllowlist.length > 0) {
    console.log(`[roomd] server allowlist: ${serverAllowlist.join(", ")}`);
  }
  if (stdioCommandAllowlist.length > 0) {
    console.log(
      `[roomd] stdio command allowlist: ${stdioCommandAllowlist.join(", ")}`,
    );
  }
  if (allowRemoteHttpServers) {
    const origins =
      remoteHttpOriginAllowlist.length > 0
        ? remoteHttpOriginAllowlist.join(", ")
        : "(none)";
    console.log(`[roomd] remote HTTP enabled; origin allowlist: ${origins}`);
  }
  if (Object.keys(httpAuthConfig).length > 0) {
    console.log(
      `[roomd] HTTP auth strategies configured for prefixes: ${Object.keys(httpAuthConfig).join(", ")}`,
    );
  }
});

function parseCommaList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value.trim().toLowerCase() === "true";
}

function parseHttpAuthConfig(
  value: string | undefined,
): Record<string, HttpAuthStrategyConfig> {
  if (!value || value.trim().length === 0) {
    return {};
  }

  const strategySchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({
      type: z.literal("bearer"),
      token: z.string(),
    }),
    z.object({
      type: z.literal("oauth"),
      issuer: z.string().min(1),
      audience: z.string().min(1).optional(),
    }),
  ]);

  const authConfigSchema = z.record(z.string().min(1), strategySchema);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`ROOMD_HTTP_AUTH_CONFIG must be valid JSON: ${message}`);
  }

  return authConfigSchema.parse(parsed);
}

function parseSinceRevision(
  sinceRevisionQuery: unknown,
  lastEventIdHeader: string | undefined,
): number | undefined {
  if (typeof sinceRevisionQuery === "string" && sinceRevisionQuery.length > 0) {
    return sinceRevisionSchema.parse(sinceRevisionQuery);
  }

  if (lastEventIdHeader && lastEventIdHeader.length > 0) {
    return sinceRevisionSchema.parse(lastEventIdHeader);
  }

  return undefined;
}

function writeSseEvent(res: express.Response, event: unknown): void {
  const eventObj = event as { type: string; revision: number };
  res.write(`id: ${eventObj.revision}\n`);
  res.write(`event: ${eventObj.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
