import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HttpError, invalidPayloadError, mapUnknownError } from "../src/errors";
import { registerRoomConfigRoutes } from "../src/server-room-config-routes";
import type { RoomConfigLoadInput, RoomConfigPlanInput } from "../src/room-config/types";

class FakeRoomConfigService {
  async list(namespace: string): Promise<unknown[]> {
    return [{ namespace, configId: "banking-room", revision: 1 }];
  }

  async get(namespace: string, configId: string): Promise<unknown | null> {
    if (configId === "missing") {
      return null;
    }
    return {
      namespace,
      configId,
      revision: 2,
      spec: {
        schemaVersion: "room-config.v1",
        instances: [],
      },
    };
  }

  async upsert(input: Record<string, unknown>): Promise<unknown> {
    return { ...input, revision: 3 };
  }

  async planLoad(_input: RoomConfigPlanInput): Promise<{
    config: { revision: number };
    plan: {
      operations: unknown[];
      summary: {
        currentMountCount: number;
        targetMountCount: number;
        currentSelectedInstanceId: string | null;
        targetSelectedInstanceId: string | null;
      };
    };
  }> {
    return {
      config: { revision: 7 },
      plan: {
        operations: [
          { type: "mount", instanceId: "ledger" },
          { type: "hide", instanceId: "fx" },
        ],
        summary: {
          currentMountCount: 0,
          targetMountCount: 2,
          currentSelectedInstanceId: null,
          targetSelectedInstanceId: "ledger",
        },
      },
    };
  }

  async loadIntoRoom(input: RoomConfigLoadInput): Promise<unknown> {
    return {
      ok: true,
      applied: !input.dryRun,
      dryRun: input.dryRun,
      roomId: input.roomId,
      mode: input.mode,
      namespace: input.namespace,
      configId: input.configId,
      revision: 9,
      plannedCommands: 2,
      plan: {
        operations: [{ type: "mount", instanceId: "ledger" }],
        summary: {
          currentMountCount: 0,
          targetMountCount: 1,
          currentSelectedInstanceId: null,
          targetSelectedInstanceId: "ledger",
        },
      },
    };
  }

  async saveFromRoomState(input: Record<string, unknown>): Promise<unknown> {
    return { ...input, revision: 4 };
  }
}

function createTestApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  registerRoomConfigRoutes(app, new FakeRoomConfigService() as never);
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
  return app;
}

describe("room config routes", () => {
  it("returns room config list response contract", async () => {
    const app = createTestApp();
    const response = await request(app).get("/room-configs?namespace=default");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.configs[0]).toMatchObject({
      namespace: "default",
      configId: "banking-room",
    });
  });

  it("returns CONFIG_NOT_FOUND for missing config", async () => {
    const app = createTestApp();
    const response = await request(app).get("/room-configs/missing?namespace=default");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      ok: false,
      code: "CONFIG_NOT_FOUND",
    });
  });

  it("returns plan contract with operations and summary", async () => {
    const app = createTestApp();
    const response = await request(app)
      .post("/room-configs/banking-room/plan")
      .send({ namespace: "default", roomId: "demo", mode: "empty_only" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      namespace: "default",
      configId: "banking-room",
      roomId: "demo",
      mode: "empty_only",
      plannedCommands: 2,
      plan: {
        operations: [
          { type: "mount", instanceId: "ledger" },
          { type: "hide", instanceId: "fx" },
        ],
      },
    });
  });

  it("returns INVALID_PAYLOAD when load request omits idempotencyKey", async () => {
    const app = createTestApp();
    const response = await request(app)
      .post("/room-configs/banking-room/load")
      .send({ namespace: "default", roomId: "demo", mode: "empty_only", dryRun: true });

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
    expect(response.body.code).toBe("INVALID_PAYLOAD");
  });

  it("returns save response contract", async () => {
    const app = createTestApp();
    const response = await request(app)
      .post("/rooms/demo/configs/banking-room/save")
      .send({ namespace: "default", visibility: "shared", title: "Banking" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      config: {
        namespace: "default",
        roomId: "demo",
        configId: "banking-room",
        visibility: "shared",
      },
    });
  });

  it("maps thrown HttpError from route handlers", async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.get("/room-configs", async (_req, _res, next) => {
      next(new HttpError(409, "ROOM_NOT_EMPTY", "boom"));
    });
    app.use((
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const mapped = mapUnknownError(error);
      res.status(mapped.statusCode).json(mapped.toResponseBody());
    });

    const response = await request(app).get("/room-configs");
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "ROOM_NOT_EMPTY" });
  });
});
