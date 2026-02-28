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

const store = new RoomStore(new RealMcpSessionFactory(), {
  eventWindowSize,
  invocationHistoryLimit,
  idempotencyKeyLimit,
  serverAllowlist,
});

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

app.get("/rooms/:roomId/instances/:instanceId/ui", async (req, res, next) => {
  try {
    const resource = await store.getInstanceUiResource(
      req.params.roomId,
      req.params.instanceId,
    );
    res.json({ ok: true, resource });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/rooms/:roomId/instances/:instanceId/capabilities",
  async (req, res, next) => {
    try {
      const capabilities = await store.getInstanceCapabilities(
        req.params.roomId,
        req.params.instanceId,
      );
      res.json({ ok: true, capabilities });
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/tools/list",
  async (req, res, next) => {
    try {
      const body = z
        .object({ cursor: z.string().optional() })
        .parse(req.body ?? {});
      const result = await store.listInstanceTools(
        req.params.roomId,
        req.params.instanceId,
        body.cursor,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/tools/call",
  async (req, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional(),
      });
      const body = schema.parse(req.body);
      const result = await store.callInstanceTool(
        req.params.roomId,
        req.params.instanceId,
        body.name,
        body.arguments ?? {},
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/resources/list",
  async (req, res, next) => {
    try {
      const body = z
        .object({ cursor: z.string().optional() })
        .parse(req.body ?? {});
      const result = await store.listInstanceResources(
        req.params.roomId,
        req.params.instanceId,
        body.cursor,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/resources/read",
  async (req, res, next) => {
    try {
      const body = z.object({ uri: z.string().min(1) }).parse(req.body);
      const result = await store.readInstanceResource(
        req.params.roomId,
        req.params.instanceId,
        body.uri,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/resources/templates/list",
  async (req, res, next) => {
    try {
      const body = z
        .object({ cursor: z.string().optional() })
        .parse(req.body ?? {});
      const result = await store.listInstanceResourceTemplates(
        req.params.roomId,
        req.params.instanceId,
        body.cursor,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/prompts/list",
  async (req, res, next) => {
    try {
      const body = z
        .object({ cursor: z.string().optional() })
        .parse(req.body ?? {});
      const result = await store.listInstancePrompts(
        req.params.roomId,
        req.params.instanceId,
        body.cursor,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/prompts/get",
  async (req, res, next) => {
    try {
      const body = GetPromptRequestParamsSchema.parse(req.body);
      const result = await store.getInstancePrompt(
        req.params.roomId,
        req.params.instanceId,
        body,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/completion/complete",
  async (req, res, next) => {
    try {
      const body = CompleteRequestParamsSchema.parse(req.body);
      const result = await store.completeInstance(
        req.params.roomId,
        req.params.instanceId,
        body,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/resources/subscribe",
  async (req, res, next) => {
    try {
      const body = SubscribeRequestParamsSchema.parse(req.body);
      const result = await store.subscribeInstanceResource(
        req.params.roomId,
        req.params.instanceId,
        body,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/rooms/:roomId/instances/:instanceId/resources/unsubscribe",
  async (req, res, next) => {
    try {
      const body = UnsubscribeRequestParamsSchema.parse(req.body);
      const result = await store.unsubscribeInstanceResource(
        req.params.roomId,
        req.params.instanceId,
        body,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const mapped = error instanceof z.ZodError
    ? invalidPayloadError({ issues: error.issues })
    : mapUnknownError(error);
  res.status(mapped.statusCode).json(mapped.toResponseBody());
});

app.listen(port, () => {
  console.log(`[roomd] listening on http://localhost:${port}`);
  if (serverAllowlist.length > 0) {
    console.log(`[roomd] server allowlist: ${serverAllowlist.join(", ")}`);
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
