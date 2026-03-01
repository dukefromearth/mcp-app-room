import { describe, expect, it } from "vitest";
import type { RoomConfigRepository } from "../src/room-config/repository";
import { RoomConfigService } from "../src/room-config/service";
import type { RoomConfigTelemetry } from "../src/room-config/telemetry";
import type {
  RoomConfigRecord,
  RoomConfigUpsertInput,
} from "../src/room-config/types";
import { commandEnvelope, newStore } from "./store.fixtures";

class InMemoryRoomConfigRepository implements RoomConfigRepository {
  private readonly records = new Map<string, RoomConfigRecord>();

  async list(namespace: string): Promise<RoomConfigRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.namespace === namespace)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(namespace: string, configId: string): Promise<RoomConfigRecord | null> {
    return this.records.get(`${namespace}:${configId}`) ?? null;
  }

  async upsert(input: RoomConfigUpsertInput): Promise<RoomConfigRecord> {
    const key = `${input.namespace}:${input.configId}`;
    const existing = this.records.get(key);
    const now = new Date().toISOString();
    const record: RoomConfigRecord = {
      namespace: input.namespace,
      configId: input.configId,
      ...(input.owner ? { owner: input.owner } : {}),
      visibility: input.visibility,
      schemaVersion: "room-config.v1",
      revision: (existing?.revision ?? 0) + 1,
      spec: input.spec,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.records.set(key, record);
    return record;
  }
}

class CaptureTelemetry implements RoomConfigTelemetry {
  readonly metrics: unknown[] = [];
  readonly events: unknown[] = [];

  increment(_metric: "room_config_requests_total", labels: unknown): void {
    this.metrics.push(labels);
  }

  record(event: unknown): void {
    this.events.push(event);
  }
}

function sampleUpsertInput(overrides: Partial<RoomConfigUpsertInput> = {}): RoomConfigUpsertInput {
  return {
    namespace: "default",
    configId: "banking-room",
    visibility: "private",
    spec: {
      schemaVersion: "room-config.v1",
      title: "Banking",
      instances: [
        {
          instanceId: "ledger",
          server: "http://localhost:3001/mcp",
          container: { x: 0, y: 0, w: 6, h: 4 },
        },
        {
          instanceId: "fx",
          server: "http://localhost:3001/mcp",
          container: { x: 6, y: 0, w: 6, h: 4 },
          visible: false,
        },
      ],
      order: ["fx", "ledger"],
      selectedInstanceId: "ledger",
    },
    ...overrides,
  };
}

describe("RoomConfigService", () => {
  it("dry-runs configuration load without mutating room state", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);
    await service.upsert(sampleUpsertInput());

    const dryRun = await service.loadIntoRoom({
      namespace: "default",
      configId: "banking-room",
      roomId: "demo",
      mode: "empty_only",
      dryRun: true,
      idempotencyKey: "dry-run-1",
    });

    expect(dryRun.applied).toBe(false);
    expect(dryRun.plannedCommands).toBe(4);
    expect(dryRun.plan.operations).toHaveLength(4);
    expect(dryRun.plan.summary.currentMountCount).toBe(0);
    expect(store.hasRoom("demo")).toBe(false);
  });

  it("loads a configuration into an empty room and applies visibility/selection", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);
    await service.upsert(sampleUpsertInput());

    const applied = await service.loadIntoRoom({
      namespace: "default",
      configId: "banking-room",
      roomId: "demo",
      mode: "empty_only",
      dryRun: false,
      idempotencyKey: "apply-1",
    });

    expect(applied.applied).toBe(true);
    expect(applied.plan.operations).toHaveLength(4);
    expect(applied.state?.mounts).toHaveLength(2);
    expect(applied.state?.order).toEqual(["fx", "ledger"]);
    expect(applied.state?.selectedInstanceId).toBe("ledger");
    expect(
      applied.state?.mounts.find((mount) => mount.instanceId === "fx")?.visible,
    ).toBe(false);
  });

  it("returns CONFIG_NOT_FOUND when loading an unknown config", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);

    await expect(
      service.loadIntoRoom({
        namespace: "default",
        configId: "missing",
        roomId: "demo",
        mode: "empty_only",
        dryRun: false,
        idempotencyKey: "missing-1",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "CONFIG_NOT_FOUND",
    });
  });

  it("returns ROOM_NOT_EMPTY when room has existing mounts in empty_only mode", async () => {
    const store = newStore();
    store.createRoom("demo");
    await store.applyCommand(
      "demo",
      commandEnvelope("mount-existing", {
        type: "mount",
        instanceId: "existing",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);
    await service.upsert(sampleUpsertInput());

    await expect(
      service.loadIntoRoom({
        namespace: "default",
        configId: "banking-room",
        roomId: "demo",
        mode: "empty_only",
        dryRun: false,
        idempotencyKey: "apply-existing",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "ROOM_NOT_EMPTY",
    });
  });

  it("rejects invalid specs with duplicate instance IDs", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);
    const input = sampleUpsertInput({
      spec: {
        schemaVersion: "room-config.v1",
        instances: [
          {
            instanceId: "dup",
            server: "http://localhost:3001/mcp",
            container: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            instanceId: "dup",
            server: "http://localhost:3001/mcp",
            container: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
    });

    await expect(service.upsert(input)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_COMMAND",
    });
  });

  it("rejects invalid specs with no instances", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);

    await expect(
      service.upsert({
        namespace: "default",
        configId: "empty-room",
        visibility: "private",
        spec: {
          schemaVersion: "room-config.v1",
          instances: [],
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_COMMAND",
    });
  });

  it("produces an explicit load plan and summary without mutating room state", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const service = new RoomConfigService(repository, store);
    await service.upsert(sampleUpsertInput());

    const planned = await service.planLoad({
      namespace: "default",
      configId: "banking-room",
      roomId: "demo",
      mode: "empty_only",
    });

    expect(planned.plan.operations).toMatchObject([
      { type: "mount", instanceId: "fx", visible: false },
      { type: "hide", instanceId: "fx" },
      { type: "mount", instanceId: "ledger", visible: true },
      { type: "select", instanceId: "ledger" },
    ]);
    expect(planned.plan.summary).toMatchObject({
      currentMountCount: 0,
      targetMountCount: 2,
      currentSelectedInstanceId: null,
      targetSelectedInstanceId: "ledger",
    });
    expect(store.hasRoom("demo")).toBe(false);
  });

  it("emits telemetry for load success and failure", async () => {
    const store = newStore();
    const repository = new InMemoryRoomConfigRepository();
    const telemetry = new CaptureTelemetry();
    const service = new RoomConfigService(repository, store, { telemetry });
    await service.upsert(sampleUpsertInput());

    await service.loadIntoRoom({
      namespace: "default",
      configId: "banking-room",
      roomId: "demo",
      mode: "empty_only",
      dryRun: true,
      idempotencyKey: "telemetry-ok",
    });

    await expect(
      service.loadIntoRoom({
        namespace: "default",
        configId: "missing",
        roomId: "demo",
        mode: "empty_only",
        dryRun: true,
        idempotencyKey: "telemetry-fail",
      }),
    ).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });

    expect(telemetry.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "load", status: "ok", namespace: "default" }),
        expect.objectContaining({ action: "load", status: "error", namespace: "default" }),
      ]),
    );
    expect(telemetry.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "load", status: "ok", configId: "banking-room" }),
        expect.objectContaining({ action: "load", status: "error", configId: "missing" }),
      ]),
    );
  });
});
