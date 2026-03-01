import { describe, expect, it } from "vitest";
import {
  roomConfigLoadSchema,
  roomConfigPlanSchema,
  roomConfigUpsertSchema,
} from "../src/schema";

describe("room config schemas", () => {
  it("accepts a valid room config upsert payload", () => {
    const parsed = roomConfigUpsertSchema.parse({
      namespace: "default",
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
        ],
      },
    });

    expect(parsed.namespace).toBe("default");
    expect(parsed.spec.instances[0]?.instanceId).toBe("ledger");
  });

  it("rejects room config order that does not cover all instances", () => {
    expect(() =>
      roomConfigUpsertSchema.parse({
        namespace: "default",
        visibility: "private",
        spec: {
          schemaVersion: "room-config.v1",
          instances: [
            {
              instanceId: "ledger",
              server: "http://localhost:3001/mcp",
              container: { x: 0, y: 0, w: 6, h: 4 },
            },
            {
              instanceId: "fx",
              server: "http://localhost:3002/mcp",
              container: { x: 6, y: 0, w: 6, h: 4 },
            },
          ],
          order: ["ledger"],
        },
      }),
    ).toThrow();
  });

  it("rejects selectedInstanceId that is not mounted", () => {
    expect(() =>
      roomConfigUpsertSchema.parse({
        namespace: "default",
        visibility: "private",
        spec: {
          schemaVersion: "room-config.v1",
          instances: [
            {
              instanceId: "ledger",
              server: "http://localhost:3001/mcp",
              container: { x: 0, y: 0, w: 6, h: 4 },
            },
          ],
          selectedInstanceId: "missing",
        },
      }),
    ).toThrow();
  });

  it("requires idempotencyKey on load payloads", () => {
    expect(() =>
      roomConfigLoadSchema.parse({
        namespace: "default",
        roomId: "demo",
        mode: "empty_only",
        dryRun: false,
      }),
    ).toThrow();
  });

  it("accepts plan payloads without idempotencyKey", () => {
    const parsed = roomConfigPlanSchema.parse({
      namespace: "default",
      roomId: "demo",
      mode: "empty_only",
    });
    expect(parsed.roomId).toBe("demo");
  });
});
