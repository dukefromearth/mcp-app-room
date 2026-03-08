import { describe, expect, it } from "vitest";
import { instanceLifecycleSchema } from "../src/schema";

describe("instanceLifecycleSchema", () => {
  it("accepts valid lifecycle payload", () => {
    const parsed = instanceLifecycleSchema.parse({
      mountNonce: "mnt-1",
      sessionId: "session-1",
      seq: 1,
      phase: "bridge_connected",
      details: {
        source: "host",
      },
    });

    expect(parsed.seq).toBe(1);
    expect(parsed.phase).toBe("bridge_connected");
  });

  it("rejects payloads missing required fields", () => {
    const result = instanceLifecycleSchema.safeParse({
      sessionId: "session-1",
      seq: 1,
      phase: "bridge_connected",
    });

    expect(result.success).toBe(false);
  });

  it("rejects seq < 1", () => {
    const result = instanceLifecycleSchema.safeParse({
      mountNonce: "mnt-1",
      sessionId: "session-1",
      seq: 0,
      phase: "bridge_connected",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown lifecycle phase", () => {
    const result = instanceLifecycleSchema.safeParse({
      mountNonce: "mnt-1",
      sessionId: "session-1",
      seq: 1,
      phase: "rpc_succeeded",
    });

    expect(result.success).toBe(false);
  });
});
