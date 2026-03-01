import { describe, expect, it } from "vitest";
import { commandEnvelope, newStore } from "./store.fixtures";

describe("RoomStore evidence and assurance", () => {
  it("records room creation evidence immediately", () => {
    const store = newStore();
    const state = store.createRoom("demo");

    expect(state.evidence).toHaveLength(1);
    expect(state.evidence[0]).toMatchObject({
      source: "roomd",
      event: "room_created",
      revision: 0,
    });
  });

  it("records mount and RPC lifecycle evidence with assurance summary", async () => {
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

    const openResult = await store.callInstanceTool(
      "demo",
      "inst-1",
      "debug-tool",
      {},
    );
    expect(openResult).toEqual({ content: [] });

    const state = store.getState("demo");
    const mountEvidence = state.evidence.find((item) => item.event === "mount_applied");
    const sentEvidence = state.evidence.find((item) => item.event === "rpc_sent");
    const succeededEvidence = state.evidence.find((item) => item.event === "rpc_succeeded");

    expect(mountEvidence?.instanceId).toBe("inst-1");
    expect(sentEvidence?.instanceId).toBe("inst-1");
    expect(succeededEvidence?.instanceId).toBe("inst-1");

    const assurance = state.assurance.instances.find((item) => item.instanceId === "inst-1");
    expect(assurance?.level).toBe("control_plane_ok");
    expect(assurance?.unknown).toContain("User-visible render completeness is unknown.");
  });

  it("records host-reported lifecycle evidence and raises assurance level", async () => {
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

    store.reportInstanceEvidence("demo", "inst-1", "host", "bridge_connected");
    store.reportInstanceEvidence("demo", "inst-1", "host", "resource_delivered");
    const state = store.reportInstanceEvidence(
      "demo",
      "inst-1",
      "host",
      "app_initialized",
    );

    const assurance = state.assurance.instances.find((item) => item.instanceId === "inst-1");
    expect(assurance?.level).toBe("ui_app_initialized");
    expect(assurance?.proven).toContain(
      "App signaled initialization through protocol callback.",
    );
    expect(assurance?.unknown).not.toContain(
      "User-visible render completeness is unknown.",
    );
  });

  it("records rpc_failed evidence when tool call throws", async () => {
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
    expect(state.evidence.some((item) => item.event === "rpc_failed")).toBe(true);
  });
});

