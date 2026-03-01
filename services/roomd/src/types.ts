export type UiResourceCsp = unknown;
export type UiResourcePermissions = unknown;
export type SessionTransportKind = "streamable-http" | "legacy-sse" | "stdio" | "unknown";

export interface ClientRoot {
  uri: string;
  name?: string;
  _meta?: Record<string, unknown>;
}

export interface ClientRootsConfig {
  enabled: boolean;
  listChanged: boolean;
  roots: ClientRoot[];
}

export interface ClientSamplingConfig {
  enabled: boolean;
  requireHumanInTheLoop: boolean;
  allowToolUse: boolean;
  maxOutputTokens: number;
  defaultModel: string;
}

export interface ClientElicitationConfig {
  enabled: boolean;
  allowFormMode: boolean;
  allowUrlMode: boolean;
  requireUrlForSensitive: boolean;
  sensitiveFieldKeywords: string[];
  defaultAction: "decline" | "cancel";
}

export interface MountClientCapabilitiesConfig {
  roots?: Partial<ClientRootsConfig>;
  sampling?: Partial<ClientSamplingConfig>;
  elicitation?: Partial<ClientElicitationConfig>;
}

export interface InstanceClientCapabilitiesConfig {
  roots: ClientRootsConfig;
  sampling: ClientSamplingConfig;
  elicitation: ClientElicitationConfig;
}

export interface SamplingPreviewResult {
  action: "approve" | "deny";
  reason?: string;
  response?: unknown;
}

export interface ElicitationPreviewResult {
  action: "accept" | "decline" | "cancel";
  reason?: string;
  response?: unknown;
}

export interface HttpServerDescriptor {
  kind: "http";
  url: string;
}

export interface StdioServerDescriptor {
  kind: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type ServerDescriptor = HttpServerDescriptor | StdioServerDescriptor;

export type HttpAuthStrategyConfig =
  | {
      type: "none";
    }
  | {
      type: "bearer";
      token: string;
    }
  | {
      type: "oauth";
      issuer: string;
      audience?: string;
    };

export interface NegotiatedSession {
  protocolVersion?: string;
  capabilities: Record<string, unknown>;
  extensions: Record<string, unknown>;
  transport: SessionTransportKind;
  clientCapabilities?: Record<string, unknown>;
}

export interface GridContainer {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomMountTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  visibility?: Array<"model" | "app">;
  uiResourceUri?: string;
}

export interface RoomMount {
  instanceId: string;
  server: string;
  uiResourceUri?: string;
  session: NegotiatedSession;
  visible: boolean;
  container: GridContainer;
  tools: RoomMountTool[];
}

export type LayoutAdapterName = "grid12";

export type LayoutOp =
  | {
      op: "set";
      instanceId: string;
      container: GridContainer;
    }
  | {
      op: "move";
      instanceId: string;
      dx: number;
      dy: number;
    }
  | {
      op: "resize";
      instanceId: string;
      dw: number;
      dh: number;
    }
  | {
      op: "swap";
      first: string;
      second: string;
    }
  | {
      op: "bring-to-front";
      instanceId: string;
    }
  | {
      op: "send-to-back";
      instanceId: string;
    }
  | {
      op: "align";
      axis: "x" | "y";
      value: number;
      instanceIds?: string[];
    }
  | {
      op: "distribute";
      axis: "x" | "y";
      gap?: number;
      instanceIds?: string[];
    }
  | {
      op: "snap";
      instanceIds?: string[];
      stepX?: number;
      stepY?: number;
    };

export type InvocationStatus = "running" | "completed" | "failed";

export interface RoomInvocation {
  invocationId: string;
  instanceId: string;
  server: string;
  toolName: string;
  input: Record<string, unknown>;
  status: InvocationStatus;
  result?: unknown;
  error?: string;
}

export interface RoomState {
  roomId: string;
  revision: number;
  mounts: RoomMount[];
  order: string[];
  selectedInstanceId: string | null;
  invocations: RoomInvocation[];
}

export type RoomEvent =
  | {
      revision: number;
      type: "state-updated";
      reason:
        | "mount"
        | "hide"
        | "show"
        | "unmount"
        | "call"
        | "call-result"
        | "call-failed"
        | "select"
        | "reorder"
        | "layout";
      state: RoomState;
    }
  | {
      revision: number;
      type: "snapshot-reset";
      reason: "subscriber-init" | "replay-window-miss";
      state: RoomState;
    };

export type RoomCommand =
  | {
      type: "mount";
      instanceId: string;
      server: string;
      container: GridContainer;
      uiResourceUri?: string;
      clientCapabilities?: MountClientCapabilitiesConfig;
    }
  | {
      type: "hide";
      instanceId: string;
    }
  | {
      type: "show";
      instanceId: string;
    }
  | {
      type: "unmount";
      instanceId: string;
    }
  | {
      type: "select";
      instanceId: string | null;
    }
  | {
      type: "reorder";
      order: string[];
    }
  | {
      type: "layout";
      adapter?: LayoutAdapterName;
      ops: LayoutOp[];
    };

export interface CommandEnvelope {
  idempotencyKey: string;
  command: RoomCommand;
}

export interface ToolUiResource {
  uiResourceUri: string;
  html: string;
  csp?: UiResourceCsp;
  permissions?: UiResourcePermissions;
}

export interface PromptGetParams {
  _meta?: Record<string, unknown>;
  name: string;
  arguments?: Record<string, string>;
}

export type CompletionRef =
  | {
      type: "ref/prompt";
      name: string;
    }
  | {
      type: "ref/resource";
      uri: string;
    };

export interface CompletionContext {
  arguments?: Record<string, string>;
}

export interface CompletionArgument {
  name: string;
  value: string;
}

export interface CompletionCompleteParams {
  _meta?: Record<string, unknown>;
  ref: CompletionRef;
  argument: CompletionArgument;
  context?: CompletionContext;
}

export interface ResourceSubscriptionParams {
  _meta?: Record<string, unknown>;
  uri: string;
}

export interface ServerInspection {
  server: string;
  tools: RoomMountTool[];
  uiCandidates: string[];
  autoMountable: boolean;
  recommendedUiResourceUri?: string;
  exampleCommands: string[];
}

export interface McpSession {
  getNegotiatedSession(): NegotiatedSession;
  close(): Promise<void>;
  notifyRootsListChanged(): Promise<void>;
  listTools(params?: { cursor?: string }): Promise<unknown>;
  callTool(toolName: string, input: Record<string, unknown>): Promise<unknown>;
  getPrompt(params: PromptGetParams): Promise<unknown>;
  complete(params: CompletionCompleteParams): Promise<unknown>;
  subscribeResource(params: ResourceSubscriptionParams): Promise<unknown>;
  unsubscribeResource(params: ResourceSubscriptionParams): Promise<unknown>;
  readUiResource(uri: string): Promise<ToolUiResource>;
  listResources(params?: { cursor?: string }): Promise<unknown>;
  readResource(params: { uri: string }): Promise<unknown>;
  listResourceTemplates(params?: { cursor?: string }): Promise<unknown>;
  listPrompts(params?: { cursor?: string }): Promise<unknown>;
  getServerCapabilities(): unknown;
}

export interface McpSessionFactory {
  getSession(roomId: string, serverUrl: string): Promise<McpSession>;
  releaseSession(roomId: string, serverUrl: string): Promise<void>;
}

export type CommandSuccessResponse = {
  ok: true;
  revision: number;
  state: RoomState;
};

export interface IdempotencyRecord {
  commandHash: string;
  statusCode: number;
  response: CommandSuccessResponse;
}
