import { describe, expect, it } from "vitest";
import { commandEnvelope, newStore } from "./store.fixtures";

describe("RoomStore capability + auth policy surfaces", () => {
  it("returns client capability snapshot for mounted instance", async () => {
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

    const capabilities = await store.getInstanceClientCapabilities("demo", "inst-1");
    expect(capabilities).toMatchObject({
      roots: { enabled: true, listChanged: true, roots: [] },
      sampling: { enabled: false },
      elicitation: { enabled: false },
    });
  });

  it("updates roots and emits roots/list_changed notification when configured", async () => {
    let notifications = 0;
    const store = newStore({
      onNotifyRootsListChanged: () => {
        notifications += 1;
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

    const updated = await store.setInstanceRoots("demo", "inst-1", [
      { uri: "file:///z", name: "z-root" },
      { uri: "file:///a", name: "a-root" },
      { uri: "file:///a", name: "a-root-dup" },
    ]);

    expect(updated.roots.roots).toEqual([
      { uri: "file:///a", name: "a-root-dup" },
      { uri: "file:///z", name: "z-root" },
    ]);
    expect(notifications).toBe(1);
  });

  it("rejects roots updates when roots capability is disabled", async () => {
    const store = newStore();
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
        clientCapabilities: {
          roots: {
            enabled: false,
          },
        },
      }),
    );

    await expect(
      store.setInstanceRoots("demo", "inst-1", [{ uri: "file:///workspace" }]),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("evaluates sampling policy previews deterministically", async () => {
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
      store.previewInstanceSampling("demo", "inst-1", {}),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });

    await store.configureInstanceSampling("demo", "inst-1", {
      enabled: true,
      requireHumanInTheLoop: false,
      allowToolUse: false,
      maxOutputTokens: 128,
      defaultModel: "gpt-4.1",
    });

    const denied = await store.previewInstanceSampling("demo", "inst-1", {
      maxTokens: 512,
    });
    expect(denied).toMatchObject({
      action: "deny",
    });

    const approved = await store.previewInstanceSampling("demo", "inst-1", {
      maxTokens: 64,
      tools: [],
    });
    expect(approved).toMatchObject({
      action: "approve",
      response: { model: "gpt-4.1" },
    });
  });

  it("enforces sensitive elicitation URL policy", async () => {
    const store = newStore();
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
        clientCapabilities: {
          elicitation: {
            enabled: true,
            allowFormMode: true,
            allowUrlMode: true,
            requireUrlForSensitive: true,
            defaultAction: "decline",
          },
        },
      }),
    );

    const sensitiveForm = await store.previewInstanceElicitation("demo", "inst-1", {
      mode: "form",
      requestedSchema: {
        type: "object",
        properties: {
          password: {
            type: "string",
          },
        },
      },
    });
    expect(sensitiveForm).toMatchObject({
      action: "decline",
    });

    const urlMode = await store.previewInstanceElicitation("demo", "inst-1", {
      mode: "url",
    });
    expect(urlMode).toEqual({ action: "accept" });
  });

  it("blocks remote HTTP servers by default", async () => {
    const store = newStore();

    await expect(store.inspectServer("https://example.com/mcp")).rejects.toMatchObject({
      statusCode: 403,
      code: "SERVER_NOT_ALLOWLISTED",
    });
  });

  it("allows remote HTTP servers when explicitly enabled and allowlisted", async () => {
    const store = newStore({
      storeOptions: {
        allowRemoteHttpServers: true,
        remoteHttpOriginAllowlist: ["https://example.com"],
      },
    });

    const inspection = await store.inspectServer("https://example.com/mcp");
    expect(inspection.server).toBe("https://example.com/mcp");
  });
});
