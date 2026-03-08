import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  CompleteRequestParamsSchema,
  GetPromptRequestParamsSchema,
  SubscribeRequestParamsSchema,
  UnsubscribeRequestParamsSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { invalidPayloadError, mapUnknownError } from "../src/errors";
import { createRoomSchema } from "../src/schema";
import { registerInstanceRoutes } from "../src/server-instance-routes";
import { commandEnvelope, newStore } from "./store.fixtures";

function createRouteTestApp() {
  const store = newStore();
  const app = express();
  app.use(express.json({ limit: "1mb" }));

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

  registerInstanceRoutes(app, store, {
    getPromptRequestParamsSchema: GetPromptRequestParamsSchema,
    completeRequestParamsSchema: CompleteRequestParamsSchema,
    subscribeRequestParamsSchema: SubscribeRequestParamsSchema,
    unsubscribeRequestParamsSchema: UnsubscribeRequestParamsSchema,
  });

  app.use((
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const mapped = error instanceof z.ZodError
      ? invalidPayloadError({ issues: error.issues })
      : mapUnknownError(error);
    res.status(mapped.statusCode).json(mapped.toResponseBody());
  });

  return { app, store };
}

async function createMountedInstance(app: express.Express, store: ReturnType<typeof newStore>) {
  store.createRoom("demo");
  await store.applyCommand(
    "demo",
    commandEnvelope("cmd-mount", {
      type: "mount",
      instanceId: "inst-1",
      server: "http://localhost:3001/mcp",
      container: { x: 0, y: 0, w: 6, h: 4 },
    }),
  );

  const payload = {
    source: "host",
    event: "app_initialized",
    details: { phase: "ready" },
  };

  const canonical = await request(app)
    .post("/rooms/demo/instances/inst-1/lifecycle")
    .send(payload);
  const compatibility = await request(app)
    .post("/rooms/demo/instances/inst-1/evidence")
    .send(payload);

  return { canonical, compatibility };
}

describe("server route contracts", () => {
  it("returns 201 then 200 idempotent envelope for POST /rooms", async () => {
    const { app } = createRouteTestApp();

    const first = await request(app).post("/rooms").send({ roomId: "demo" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      ok: true,
      created: true,
      state: {
        roomId: "demo",
      },
    });

    const second = await request(app).post("/rooms").send({ roomId: "demo" });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      ok: true,
      created: false,
      state: {
        roomId: "demo",
      },
    });
    expect(
      second.body.state.evidence.filter((item: { event: string }) => item.event === "room_created"),
    ).toHaveLength(1);
  });

  it("keeps canonical and compatibility lifecycle routes envelope-equivalent", async () => {
    const { app, store } = createRouteTestApp();
    const { canonical, compatibility } = await createMountedInstance(app, store);

    expect(canonical.status).toBe(200);
    expect(compatibility.status).toBe(200);

    expect(canonical.body.ok).toBe(true);
    expect(compatibility.body.ok).toBe(true);
    expect(canonical.body.state.roomId).toBe("demo");
    expect(compatibility.body.state.roomId).toBe("demo");

    const canonicalEvent = canonical.body.state.evidence.find(
      (item: { event: string; instanceId?: string }) =>
        item.event === "app_initialized" && item.instanceId === "inst-1",
    );
    const compatibilityEvent = compatibility.body.state.evidence.find(
      (item: { event: string; instanceId?: string }) =>
        item.event === "app_initialized" && item.instanceId === "inst-1",
    );
    expect(canonicalEvent).toBeDefined();
    expect(compatibilityEvent).toBeDefined();
    expect(canonical.body.state.lifecycle).toBeUndefined();
    expect(compatibility.body.state.lifecycle).toBeUndefined();
  });

  it("emits compatibility route telemetry marker for /evidence alias usage", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { app, store } = createRouteTestApp();
      await createMountedInstance(app, store);

      const compatibilityLog = logSpy.mock.calls
        .map(([line]) => {
          if (typeof line !== "string") {
            return null;
          }
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .find((entry) => entry?.msg === "lifecycle.compatibility_route_hit");

      expect(compatibilityLog).toMatchObject({
        msg: "lifecycle.compatibility_route_hit",
        roomId: "demo",
        instanceId: "inst-1",
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns INVALID_PAYLOAD contract for malformed lifecycle payload", async () => {
    const { app, store } = createRouteTestApp();
    store.createRoom("demo");
    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const response = await request(app)
      .post("/rooms/demo/instances/inst-1/lifecycle")
      .send({
        source: "host",
        event: "unknown_event",
      });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("INVALID_PAYLOAD");
    expect(Array.isArray(response.body.details?.issues)).toBe(true);
  });

  it("returns typed not-found errors for missing lifecycle room/instance", async () => {
    const { app, store } = createRouteTestApp();
    store.createRoom("demo");

    const missingRoom = await request(app)
      .post("/rooms/missing/instances/inst-1/lifecycle")
      .send({
        source: "host",
        event: "bridge_connected",
      });
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.body).toMatchObject({
      ok: false,
      code: "ROOM_NOT_FOUND",
    });

    const missingInstance = await request(app)
      .post("/rooms/demo/instances/inst-404/evidence")
      .send({
        source: "host",
        event: "bridge_connected",
      });
    expect(missingInstance.status).toBe(404);
    expect(missingInstance.body).toMatchObject({
      ok: false,
      code: "INSTANCE_NOT_FOUND",
    });
  });
});
