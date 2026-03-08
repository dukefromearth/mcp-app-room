#!/usr/bin/env node
import { randomUUID } from "node:crypto";
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
import { registerRoomConfigRoutes } from "./server-room-config-routes";
import type { HttpAuthStrategyConfig } from "./types";
import {
  resolveRemoteHttpOriginAllowlist,
  resolveStdioAllowlist,
} from "./dev-security-overrides";
import { RoomConfigService } from "./room-config/service";
import { createSqliteRoomConfigRepository } from "./room-config/sqlite-repository";
import { getRoomdLogger, runWithLogContext, serializeError } from "./logging";

const logger = getRoomdLogger({ component: "server" });

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
const roomConfigDbPath = process.env.ROOMD_CONFIG_DB_PATH?.trim()
  || "data/room-configs.sqlite";

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
const roomConfigRepository = createSqliteRoomConfigRepository(roomConfigDbPath);
await roomConfigRepository.initialize();
const roomConfigService = new RoomConfigService(roomConfigRepository, store);

for (const roomId of parseCommaList(process.env.ROOMD_BOOTSTRAP_ROOMS)) {
  if (!store.hasRoom(roomId)) {
    store.createRoom(roomId);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const requestIdHeader = req.header("x-request-id");
  const requestId = requestIdHeader?.trim().length
    ? requestIdHeader.trim()
    : randomUUID();
  const startedAt = Date.now();

  runWithLogContext(
    {
      requestId,
      method: req.method,
      route: req.path,
    },
    () => {
      logger.info("http.request.enter", {
        hasBody: req.body !== undefined,
      });
      res.setHeader("x-request-id", requestId);
      res.on("finish", () => {
        logger.info("http.request.exit", {
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
        });
      });
      res.on("close", () => {
        if (!res.writableEnded) {
          logger.debug("http.request.client_closed", {
            durationMs: Date.now() - startedAt,
          });
        }
      });
      next();
    },
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/rooms", (req, res, next) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    next(parsed.error);
    return;
  }

  const { roomId } = parsed.data;
  try {
    const state = store.createRoom(roomId);
    res.status(201).json({ ok: true, created: true, state });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ROOM_EXISTS") {
      const state = store.getState(roomId);
      res.status(200).json({ ok: true, created: false, state });
      return;
    }
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
registerRoomConfigRoutes(app, roomConfigService);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const mapped = error instanceof z.ZodError
    ? invalidPayloadError({ issues: error.issues })
    : mapUnknownError(error);
  logger.warn("http.request.error", {
    statusCode: mapped.statusCode,
    code: mapped.code,
    error: serializeError(error),
  });
  res.status(mapped.statusCode).json(mapped.toResponseBody());
});

app.listen(port, () => {
  logger.info("server.listen", { url: `http://localhost:${port}` });
  if (dangerouslyAllowStdio) {
    logger.warn("server.security_override_stdio", {
      message:
        "DANGEROUSLY_ALLOW_STDIO enabled; empty stdio allowlist defaults to wildcard.",
    });
  }
  if (dangerouslyAllowRemoteHttp) {
    logger.warn("server.security_override_remote_http", {
      message:
        "DANGEROUSLY_ALLOW_REMOTE_HTTP enabled; remote HTTP and wildcard origins may be accepted.",
    });
  }
  if (serverAllowlist.length > 0) {
    logger.info("server.allowlist", { serverAllowlist });
  }
  if (stdioCommandAllowlist.length > 0) {
    logger.info("server.stdio_allowlist", { stdioCommandAllowlist });
  }
  if (allowRemoteHttpServers) {
    const origins =
      remoteHttpOriginAllowlist.length > 0
        ? remoteHttpOriginAllowlist.join(", ")
        : "(none)";
    logger.info("server.remote_http_enabled", { origins });
  }
  if (Object.keys(httpAuthConfig).length > 0) {
    logger.info("server.http_auth_configured", {
      prefixes: Object.keys(httpAuthConfig),
    });
  }
});

function parseCommaList(value: string | undefined): string[] {
  logger.debug("parseCommaList.enter", { hasValue: !!value });
  if (!value) {
    logger.debug("parseCommaList.exit", { items: 0 });
    return [];
  }

  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  logger.debug("parseCommaList.exit", { items: parsed.length });
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  logger.debug("parseBoolean.enter", { hasValue: !!value });
  if (!value) {
    logger.debug("parseBoolean.exit", { parsed: false });
    return false;
  }
  const parsed = value.trim().toLowerCase() === "true";
  logger.debug("parseBoolean.exit", { parsed });
  return parsed;
}

function parseHttpAuthConfig(
  value: string | undefined,
): Record<string, HttpAuthStrategyConfig> {
  logger.debug("parseHttpAuthConfig.enter", { hasValue: !!value });
  if (!value || value.trim().length === 0) {
    logger.debug("parseHttpAuthConfig.exit", { prefixes: 0 });
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
    logger.debug("parseHttpAuthConfig.json_error", {
      error: serializeError(error),
    });
    throw new Error(`ROOMD_HTTP_AUTH_CONFIG must be valid JSON: ${message}`);
  }

  const validated = authConfigSchema.parse(parsed);
  logger.debug("parseHttpAuthConfig.exit", {
    prefixes: Object.keys(validated).length,
  });
  return validated;
}

function parseSinceRevision(
  sinceRevisionQuery: unknown,
  lastEventIdHeader: string | undefined,
): number | undefined {
  logger.debug("parseSinceRevision.enter", {
    hasSinceRevisionQuery: typeof sinceRevisionQuery === "string",
    hasLastEventIdHeader: !!lastEventIdHeader,
  });
  if (typeof sinceRevisionQuery === "string" && sinceRevisionQuery.length > 0) {
    const parsed = sinceRevisionSchema.parse(sinceRevisionQuery);
    logger.debug("parseSinceRevision.exit", { source: "query", parsed });
    return parsed;
  }

  if (lastEventIdHeader && lastEventIdHeader.length > 0) {
    const parsed = sinceRevisionSchema.parse(lastEventIdHeader);
    logger.debug("parseSinceRevision.exit", { source: "last-event-id", parsed });
    return parsed;
  }

  logger.debug("parseSinceRevision.exit", { source: "none" });
  return undefined;
}

function writeSseEvent(res: express.Response, event: unknown): void {
  const eventObj = event as { type: string; revision: number };
  logger.debug("writeSseEvent", {
    type: eventObj.type,
    revision: eventObj.revision,
  });
  res.write(`id: ${eventObj.revision}\n`);
  res.write(`event: ${eventObj.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
