import { describe, expect, it } from "vitest";
import { RoomStore, HttpError } from "../src/store";
import type {
  CommandEnvelope,
  McpSession,
  McpSessionFactory,
  SessionToolInfo,
} from "../src/types";

class FakeSession implements McpSession {
  constructor(
    private readonly toolInfo: SessionToolInfo,
    private readonly onCallTool: (name: string, input: Record<string, unknown>) => Promise<unknown>,
  ) {}

  async listToolInfo(_toolName: string): Promise<SessionToolInfo> {
    return this.toolInfo;
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    return this.onCallTool(name, input);
  }

  async readUiResource(uri: string): Promise<{
    uiResourceUri: string;
    html: string;
  }> {
    return { uiResourceUri: uri, html: "<html></html>" };
  }

  async listResources(): Promise<unknown> {
    return { resources: [] };
  }

  async readResource(): Promise<unknown> {
    return { contents: [] };
  }

  async listResourceTemplates(): Promise<unknown> {
    return { resourceTemplates: [] };
  }

  async listPrompts(): Promise<unknown> {
    return { prompts: [] };
  }

  getServerCapabilities(): unknown {
    return { tools: {}, resources: {} };
  }
}

class FakeFactory implements McpSessionFactory {
  constructor(private readonly session: McpSession) {}

  async getSession(): Promise<McpSession> {
    return this.session;
  }
}

function newStore(callResult: Promise<unknown>): RoomStore {
  const session = new FakeSession(
    {
      tool: { name: "debug-tool", inputSchema: { type: "object" } },
      uiResourceUri: "ui://debug-tool/mcp-app.html",
    },
    async () => callResult,
  );

  return new RoomStore(new FakeFactory(session), {
    eventWindowSize: 2,
    invocationHistoryLimit: 50,
    idempotencyKeyLimit: 50,
  });
}

function commandEnvelope(
  idempotencyKey: string,
  command: CommandEnvelope["command"],
): CommandEnvelope {
  return { idempotencyKey, command };
}

describe("RoomStore", () => {
  it("requires explicit room creation", () => {
    const store = newStore(Promise.resolve({ content: [] }));

    expect(() => store.getState("demo")).toThrow(HttpError);

    const state = store.createRoom("demo");
    expect(state.roomId).toBe("demo");
    expect(state.revision).toBe(0);
  });

  it("enforces idempotency with same payload replay", async () => {
    const store = newStore(Promise.resolve({ content: [] }));
    store.createRoom("demo");

    const envelope = commandEnvelope("cmd-1", {
      type: "mount",
      instanceId: "inst-1",
      server: "http://localhost:3001/mcp",
      toolName: "debug-tool",
      container: { x: 0, y: 0, w: 6, h: 4 },
    });

    const first = await store.applyCommand("demo", envelope);
    const second = await store.applyCommand("demo", envelope);

    expect(first.response).toEqual(second.response);
    expect((first.response as { revision: number }).revision).toBe(1);
    expect(store.getState("demo").revision).toBe(1);
  });

  it("rejects idempotency key reuse with different payload", async () => {
    const store = newStore(Promise.resolve({ content: [] }));
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-1", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        toolName: "debug-tool",
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
          toolName: "debug-tool",
          container: { x: 0, y: 0, w: 6, h: 4 },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("applies mount/hide/show/unmount lifecycle and revisions", async () => {
    const store = newStore(Promise.resolve({ content: [] }));
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        toolName: "debug-tool",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-hide", { type: "hide", instanceId: "inst-1" }),
    );

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-show", { type: "show", instanceId: "inst-1" }),
    );

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount", { type: "unmount", instanceId: "inst-1" }),
    );

    const state = store.getState("demo");
    expect(state.revision).toBe(4);
    expect(state.mounts).toHaveLength(0);
  });

  it("acks call asynchronously and updates state when result resolves", async () => {
    let resolveCall: ((value: unknown) => void) | undefined;
    const callResult = new Promise((resolve) => {
      resolveCall = resolve;
    });

    const store = newStore(callResult);
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        toolName: "debug-tool",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const callResponse = await store.applyCommand(
      "demo",
      commandEnvelope("cmd-call", {
        type: "call",
        instanceId: "inst-1",
        input: { q: 1 },
      }),
    );

    expect(callResponse.statusCode).toBe(202);
    expect(callResponse.response).toMatchObject({ ok: true, accepted: true });

    const pendingState = store.getState("demo");
    const pendingInvocation = pendingState.invocations.at(-1);
    expect(pendingInvocation?.status).toBe("running");

    resolveCall?.({ content: [{ type: "text", text: "ok" }] });

    await waitFor(() => {
      const invocation = store.getState("demo").invocations.at(-1);
      return invocation?.status === "completed";
    });

    const completedInvocation = store.getState("demo").invocations.at(-1);
    expect(completedInvocation?.result).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("returns snapshot-reset when replay window is unavailable", async () => {
    const store = newStore(Promise.resolve({ content: [] }));
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-1", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        toolName: "debug-tool",
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

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition not met within timeout");
}
