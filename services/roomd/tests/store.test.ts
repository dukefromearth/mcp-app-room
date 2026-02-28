import { describe, expect, it } from "vitest";
import { HttpError } from "../src/store";
import { commandEnvelope, newStore } from "./store.fixtures";

describe("RoomStore", () => {
  it("requires explicit room creation", () => {
    const store = newStore();

    expect(() => store.getState("demo")).toThrow(HttpError);

    const state = store.createRoom("demo");
    expect(state.roomId).toBe("demo");
    expect(state.revision).toBe(0);
  });

  it("enforces idempotency with same payload replay", async () => {
    const store = newStore();
    store.createRoom("demo");

    const envelope = commandEnvelope("cmd-1", {
      type: "mount",
      instanceId: "inst-1",
      server: "http://localhost:3001/mcp",
      container: { x: 0, y: 0, w: 6, h: 4 },
    });

    const first = await store.applyCommand("demo", envelope);
    const second = await store.applyCommand("demo", envelope);

    expect(first.response).toEqual(second.response);
    expect(first.response.revision).toBe(1);
    expect(store.getState("demo").revision).toBe(1);
  });

  it("rejects idempotency key reuse with different payload", async () => {
    const store = newStore();
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-1", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    await expect(
      store.applyCommand(
        "demo",
        commandEnvelope("cmd-1", {
          type: "mount",
          instanceId: "inst-2",
          server: "http://localhost:3001/mcp",
          container: { x: 0, y: 0, w: 6, h: 4 },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("mounts with a single UI candidate and persists full tool catalog", async () => {
    const store = newStore();
    store.createRoom("demo");

    const result = await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    expect(result.statusCode).toBe(200);
    const mount = store.getState("demo").mounts[0];
    expect(mount.uiResourceUri).toBe("ui://debug-tool/mcp-app.html");
    expect(mount.tools).toHaveLength(2);
    expect(mount.tools[0]).toMatchObject({ name: "debug-tool", title: "Debug" });
    expect(mount.tools[1]).toMatchObject({ name: "replace", title: "Replace" });
    expect(mount.session).toMatchObject({
      protocolVersion: "2025-11-25",
      transport: "streamable-http",
      capabilities: {
        tools: {},
        resources: {},
      },
    });
  });

  it("returns mounted negotiated capabilities snapshot", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
        },
      },
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

    const capabilities = await store.getInstanceCapabilities("demo", "inst-1");
    expect(capabilities).toEqual({
      tools: {},
    });
  });

  it("returns UNSUPPORTED_CAPABILITY when route capability is missing", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
        },
      },
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
      store.listInstanceResources("demo", "inst-1"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("allows capability-gated route when capability is present", async () => {
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

    await expect(
      store.listInstanceResources("demo", "inst-1"),
    ).resolves.toEqual({
      resources: [{ uri: "ui://debug-tool/mcp-app.html" }],
    });
  });

  it("allows non-UI mount when no UI candidates exist", async () => {
    const store = newStore({
      resources: [{ uri: "file://notes.txt", mimeType: "text/plain" }],
    });
    store.createRoom("demo");

    const result = await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(store.getState("demo").mounts[0].uiResourceUri).toBeUndefined();
  });

  it("allows non-UI mount when UI candidates are ambiguous", async () => {
    const store = newStore({
      resources: [
        { uri: "ui://a/mcp-app.html" },
        { uri: "ui://b/mcp-app.html" },
      ],
    });
    store.createRoom("demo");

    const result = await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    expect(result.statusCode).toBe(200);
    expect(store.getState("demo").mounts[0].uiResourceUri).toBeUndefined();
  });

  it("accepts explicit uiResourceUri when it matches a candidate", async () => {
    const store = newStore({
      resources: [
        { uri: "ui://a/mcp-app.html" },
        { uri: "ui://b/mcp-app.html" },
      ],
    });
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
        uiResourceUri: "ui://b/mcp-app.html",
      }),
    );

    expect(store.getState("demo").mounts[0].uiResourceUri).toBe("ui://b/mcp-app.html");
  });

  it("rejects explicit uiResourceUri when it does not match candidates", async () => {
    const store = newStore({
      resources: [
        { uri: "ui://a/mcp-app.html" },
        { uri: "ui://b/mcp-app.html" },
      ],
    });
    store.createRoom("demo");

    await expect(
      store.applyCommand(
        "demo",
        commandEnvelope("cmd-mount", {
          type: "mount",
          instanceId: "inst-1",
          server: "http://localhost:3001/mcp",
          container: { x: 0, y: 0, w: 6, h: 4 },
          uiResourceUri: "ui://missing/mcp-app.html",
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: "UI_RESOURCE_INVALID" });
  });

  it("reads selected mount UI resource", async () => {
    const store = newStore({
      resources: [
        { uri: "ui://a/mcp-app.html" },
        { uri: "ui://b/mcp-app.html" },
      ],
    });
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
        uiResourceUri: "ui://a/mcp-app.html",
      }),
    );

    const resource = await store.getInstanceUiResource("demo", "inst-1");
    expect(resource.uiResourceUri).toBe("ui://a/mcp-app.html");
    expect(resource.html).toContain("ui://a/mcp-app.html");
  });

  it("returns NO_UI_RESOURCE for mounted instances without UI", async () => {
    const store = newStore({
      resources: [{ uri: "file://notes.txt", mimeType: "text/plain" }],
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
      store.getInstanceUiResource("demo", "inst-1"),
    ).rejects.toMatchObject({ statusCode: 404, code: "NO_UI_RESOURCE" });
  });

  it("returns deterministic server inspection output", async () => {
    const store = newStore({
      resources: [
        { uri: "ui://z/mcp-app.html" },
        { uri: "ui://a/mcp-app.html" },
      ],
    });

    const inspection = await store.inspectServer("http://localhost:3001/mcp");

    expect(inspection.server).toBe("http://localhost:3001/mcp");
    expect(inspection.tools.map((tool) => tool.name)).toEqual(["debug-tool", "replace"]);
    expect(inspection.uiCandidates).toEqual(["ui://a/mcp-app.html", "ui://z/mcp-app.html"]);
    expect(inspection.autoMountable).toBe(false);
    expect(inspection.recommendedUiResourceUri).toBeUndefined();
    expect(inspection.exampleCommands.some((cmd) => cmd.includes("roomctl mount"))).toBe(true);
  });

  it("inspects from tool metadata when resources/list is unavailable", async () => {
    const store = newStore({
      failListResources: true,
      includeToolUiMetadata: true,
    });

    const inspection = await store.inspectServer("http://localhost:3001/mcp");
    expect(inspection.server).toBe("http://localhost:3001/mcp");
    expect(inspection.tools.map((tool) => tool.name)).toEqual(["debug-tool", "replace"]);
    expect(inspection.uiCandidates).toEqual(["ui://debug-tool/mcp-app.html"]);
    expect(inspection.autoMountable).toBe(true);
  });

  it("ignores malformed tool UI metadata during inspection", async () => {
    const store = newStore({
      invalidToolUiMetadata: true,
      failListResources: true,
    });

    const inspection = await store.inspectServer("http://localhost:3001/mcp");
    expect(inspection.server).toBe("http://localhost:3001/mcp");
    expect(inspection.tools.map((tool) => tool.name)).toEqual(["debug-tool", "replace"]);
    expect(inspection.uiCandidates).toEqual([]);
    expect(inspection.autoMountable).toBe(false);
  });

  it("tracks direct tools/call invocations and emits state updates", async () => {
    const store = newStore({ callResult: Promise.resolve({ content: [{ type: "text", text: "ok" }] }) });
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

    const reasons: string[] = [];
    const unsubscribe = store.subscribe("demo", (event) => {
      if (event.type === "state-updated") {
        reasons.push(event.reason);
      }
    });

    const result = await store.callInstanceTool("demo", "inst-1", "replace", {
      sessionId: "demo",
      markdown: "# Updated",
    });
    unsubscribe();

    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(reasons).toContain("call");
    expect(reasons).toContain("call-result");

    const state = store.getState("demo");
    const invocation = state.invocations.at(-1);
    expect(invocation?.toolName).toBe("replace");
    expect(invocation?.status).toBe("completed");
    expect(state.selectedInstanceId).toBe("inst-1");
  });

  it("returns snapshot-reset when replay window is unavailable", async () => {
    const store = newStore();
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-1", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );
    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-2", { type: "hide", instanceId: "inst-1" }),
    );
    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-3", { type: "show", instanceId: "inst-1" }),
    );

    const replay = store.getReplayEvents("demo", 0);
    expect(replay).toHaveLength(1);
    expect(replay[0]).toMatchObject({ type: "snapshot-reset" });
  });
});
