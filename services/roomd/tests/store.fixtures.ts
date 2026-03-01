import { RoomStore } from "../src/store";
import type {
  CompletionCompleteParams,
  CommandEnvelope,
  McpSession,
  McpSessionFactory,
  NegotiatedSession,
  PromptGetParams,
  ResourceSubscriptionParams,
} from "../src/types";

class FakeSession implements McpSession {
  constructor(
    private readonly tools: Array<Record<string, unknown>>,
    private readonly resources: Array<Record<string, unknown>>,
    private readonly failListResources: boolean,
    private readonly negotiatedSession: NegotiatedSession,
    private readonly onCallTool: (name: string, input: Record<string, unknown>) => Promise<unknown>,
    private readonly onGetPrompt: (params: PromptGetParams) => Promise<unknown>,
    private readonly onComplete: (params: CompletionCompleteParams) => Promise<unknown>,
    private readonly onSubscribe: (params: ResourceSubscriptionParams) => Promise<unknown>,
    private readonly onUnsubscribe: (params: ResourceSubscriptionParams) => Promise<unknown>,
    private readonly onNotifyRootsListChanged: () => void,
  ) {}

  getNegotiatedSession(): NegotiatedSession {
    return {
      ...this.negotiatedSession,
      capabilities: { ...this.negotiatedSession.capabilities },
      extensions: { ...this.negotiatedSession.extensions },
      ...(this.negotiatedSession.clientCapabilities
        ? { clientCapabilities: { ...this.negotiatedSession.clientCapabilities } }
        : {}),
    };
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async notifyRootsListChanged(): Promise<void> {
    this.onNotifyRootsListChanged();
  }

  async listTools(): Promise<unknown> {
    return { tools: this.tools };
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    return this.onCallTool(name, input);
  }

  async getPrompt(params: PromptGetParams): Promise<unknown> {
    return this.onGetPrompt(params);
  }

  async complete(params: CompletionCompleteParams): Promise<unknown> {
    return this.onComplete(params);
  }

  async subscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    return this.onSubscribe(params);
  }

  async unsubscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    return this.onUnsubscribe(params);
  }

  async readUiResource(uri: string): Promise<{
    uiResourceUri: string;
    html: string;
  }> {
    return { uiResourceUri: uri, html: `<html>${uri}</html>` };
  }

  async listResources(): Promise<unknown> {
    if (this.failListResources) {
      throw new Error("resources/list unavailable");
    }
    return { resources: this.resources };
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
    return this.negotiatedSession.capabilities;
  }
}

class FakeFactory implements McpSessionFactory {
  constructor(private readonly session: McpSession) {}

  async getSession(): Promise<McpSession> {
    return this.session;
  }

  async releaseSession(): Promise<void> {
    return Promise.resolve();
  }
}

export interface NewStoreOptions {
  resources?: Array<Record<string, unknown>>;
  failListResources?: boolean;
  includeToolUiMetadata?: boolean;
  invalidToolUiMetadata?: boolean;
  toolVisibility?: Array<"model" | "app">;
  negotiatedSession?: Partial<NegotiatedSession>;
  callResult?: Promise<unknown>;
  promptResult?: Promise<unknown>;
  completeResult?: Promise<unknown>;
  subscribeResult?: Promise<unknown>;
  unsubscribeResult?: Promise<unknown>;
  onNotifyRootsListChanged?: () => void;
  storeOptions?: {
    serverAllowlist?: string[];
    stdioCommandAllowlist?: string[];
    allowRemoteHttpServers?: boolean;
    remoteHttpOriginAllowlist?: string[];
  };
}

export function newStore(options: NewStoreOptions = {}): RoomStore {
  const debugTool: Record<string, unknown> = {
    name: "debug-tool",
    title: "Debug",
    description: "Debug helper",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" } },
    },
  };
  if (options.includeToolUiMetadata) {
    debugTool._meta = { ui: { resourceUri: "ui://debug-tool/mcp-app.html" } };
  } else if (options.invalidToolUiMetadata) {
    debugTool._meta = { ui: { resourceUri: "https://invalid.example/app.html" } };
  }
  if (options.toolVisibility) {
    const meta = (debugTool._meta ?? {}) as { ui?: Record<string, unknown> };
    debugTool._meta = {
      ...meta,
      ui: {
        ...(meta.ui ?? {}),
        visibility: options.toolVisibility,
      },
    };
  }

  const session = new FakeSession(
    [
      debugTool,
      {
        name: "replace",
        title: "Replace",
        description: "Replace markdown",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string" },
            markdown: { type: "string" },
          },
        },
      },
    ],
    options.resources ?? [{ uri: "ui://debug-tool/mcp-app.html" }],
    options.failListResources ?? false,
    {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: {},
        resources: {
          subscribe: true,
        },
        prompts: {},
        completions: {},
      },
      extensions: {
        "io.modelcontextprotocol/ui": {},
      },
      transport: "streamable-http",
      ...(options.negotiatedSession ?? {}),
    },
    async () => options.callResult ?? Promise.resolve({ content: [] }),
    async (params) =>
      options.promptResult ?? Promise.resolve({ messages: [], echo: params }),
    async (params) =>
      options.completeResult ??
      Promise.resolve({ completion: { values: ["default"] }, echo: params }),
    async (params) =>
      options.subscribeResult ?? Promise.resolve({ ok: true, echo: params }),
    async (params) =>
      options.unsubscribeResult ?? Promise.resolve({ ok: true, echo: params }),
    options.onNotifyRootsListChanged ?? (() => {}),
  );

  return new RoomStore(new FakeFactory(session), {
    eventWindowSize: 2,
    invocationHistoryLimit: 50,
    idempotencyKeyLimit: 50,
    ...(options.storeOptions ?? {}),
  });
}

export function commandEnvelope(
  idempotencyKey: string,
  command: CommandEnvelope["command"],
): CommandEnvelope {
  return { idempotencyKey, command };
}
