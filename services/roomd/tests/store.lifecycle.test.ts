import { describe, expect, it } from "vitest";
import { HttpError } from "../src/errors";
import { commandEnvelope, newStore } from "./store.fixtures";

describe("RoomStore lifecycle and assurance", () => {
  it("starts with empty lifecycle for a new room", () => {
    const store = newStore();
    const state = store.createRoom("demo");

    expect(state.lifecycle.instances).toHaveLength(0);
  });

  it("returns idempotent create status contract", () => {
    const store = newStore();

    const first = store.createRoomWithStatus("demo");
    expect(first.created).toBe(true);
    expect(first.state.roomId).toBe("demo");

    const second = store.createRoomWithStatus("demo");
    expect(second.created).toBe(false);
    expect(second.state.roomId).toBe("demo");
    expect(second.state.revision).toBe(first.state.revision);
  });

  it("records lifecycle phases and raises assurance level", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0];
    expect(mounted).toBeDefined();

    const first = store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted!.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );
    expect(first.accepted).toBe("applied");

    const second = store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted!.mountNonce,
      "session-a",
      2,
      "resource_delivered",
    );
    expect(second.accepted).toBe("applied");

    const third = store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted!.mountNonce,
      "session-a",
      3,
      "app_initialized",
    );
    expect(third.accepted).toBe("applied");

    const lifecycleEntry = third.state.lifecycle.instances.find(
      (item) => item.instanceId === "inst-1",
    );
    expect(lifecycleEntry).toMatchObject({
      instanceId: "inst-1",
      mountNonce: mounted!.mountNonce,
      sessionId: "session-a",
      seq: 3,
      phase: "app_initialized",
    });

    const assurance = third.state.assurance.instances.find((item) => item.instanceId === "inst-1");
    expect(assurance?.level).toBe("ui_app_initialized");
    expect(assurance?.unknown).not.toContain("User-visible render completeness is unknown.");
  });

  it("treats exact duplicate lifecycle event as idempotent without revision bump", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0]!;
    const applied = store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );
    const duplicate = store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );

    expect(applied.accepted).toBe("applied");
    expect(duplicate.accepted).toBe("duplicate");
    expect(duplicate.state.revision).toBe(applied.state.revision);
  });

  it("rejects stale session seq updates", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0]!;
    store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );

    await expect(() =>
      store.reportInstanceLifecycle(
        "demo",
        "inst-1",
        mounted.mountNonce,
        "session-b",
        2,
        "resource_delivered",
      )
    ).toThrowError(/stale/i);
  });

  it("rejects replay from a previously closed session", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0]!;
    store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );
    store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-b",
      1,
      "bridge_connected",
    );

    const replayClosedSession = () =>
      store.reportInstanceLifecycle(
        "demo",
        "inst-1",
        mounted.mountNonce,
        "session-a",
        1,
        "bridge_connected",
      );

    expect(replayClosedSession).toThrowError(HttpError);
    try {
      replayClosedSession();
    } catch (error) {
      const mapped = error as HttpError;
      expect(mapped.code).toBe("LIFECYCLE_STALE_SESSION");
    }
  });

  it("rejects stale mount lifecycle submissions after remount", async () => {
    const store = newStore();
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
    const firstMountNonce = store.getState("demo").mounts[0]!.mountNonce;

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount", {
        type: "unmount",
        instanceId: "inst-1",
      }),
    );
    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-remount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const report = () =>
      store.reportInstanceLifecycle(
        "demo",
        "inst-1",
        firstMountNonce,
        "session-a",
        1,
        "bridge_connected",
      );

    expect(report).toThrowError(HttpError);
    try {
      report();
    } catch (error) {
      const mapped = error as HttpError;
      expect(mapped.code).toBe("LIFECYCLE_STALE_MOUNT");
    }
  });

  it("rejects out-of-order lifecycle sequence values", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0]!;
    store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );

    const report = () =>
      store.reportInstanceLifecycle(
        "demo",
        "inst-1",
        mounted.mountNonce,
        "session-a",
        3,
        "app_initialized",
      );

    expect(report).toThrowError(HttpError);
    try {
      report();
    } catch (error) {
      const mapped = error as HttpError;
      expect(mapped.code).toBe("LIFECYCLE_SEQ_OUT_OF_ORDER");
      expect(mapped.details).toMatchObject({
        expectedSeq: 2,
        receivedSeq: 3,
      });
    }
  });

  it("rejects illegal lifecycle transitions", async () => {
    const store = newStore();
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

    const mounted = store.getState("demo").mounts[0]!;
    store.reportInstanceLifecycle(
      "demo",
      "inst-1",
      mounted.mountNonce,
      "session-a",
      1,
      "bridge_connected",
    );

    const report = () =>
      store.reportInstanceLifecycle(
        "demo",
        "inst-1",
        mounted.mountNonce,
        "session-a",
        2,
        "app_initialized",
      );

    expect(report).toThrowError(HttpError);
    try {
      report();
    } catch (error) {
      const mapped = error as HttpError;
      expect(mapped.code).toBe("LIFECYCLE_INVALID_TRANSITION");
      expect(mapped.details).toMatchObject({
        fromPhase: "bridge_connected",
        toPhase: "app_initialized",
      });
    }
  });

  it("keeps tool RPC failure independent from lifecycle surface", async () => {
    const store = newStore({
      callResult: Promise.reject(new Error("boom")),
    });
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

    await expect(
      store.callInstanceTool("demo", "inst-1", "debug-tool", {}),
    ).rejects.toThrow("boom");

    const state = store.getState("demo");
    expect(state.lifecycle.instances).toHaveLength(0);
  });
});
