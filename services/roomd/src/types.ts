export type UiResourceCsp = unknown;
export type UiResourcePermissions = unknown;

export interface GridContainer {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomMount {
  instanceId: string;
  server: string;
  toolName: string;
  uiResourceUri?: string;
  visible: boolean;
  container: GridContainer;
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
        | "resolve-ui-uri"
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
      toolName: string;
      container: GridContainer;
      initialInput?: Record<string, unknown>;
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
      type: "call";
      instanceId: string;
      input?: Record<string, unknown>;
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

export interface SessionToolInfo {
  tool: unknown;
  uiResourceUri?: string;
}

export interface McpSession {
  listToolInfo(toolName: string): Promise<SessionToolInfo>;
  callTool(toolName: string, input: Record<string, unknown>): Promise<unknown>;
  readUiResource(uri: string): Promise<ToolUiResource>;
  listResources(params?: { cursor?: string }): Promise<unknown>;
  readResource(params: { uri: string }): Promise<unknown>;
  listResourceTemplates(params?: { cursor?: string }): Promise<unknown>;
  listPrompts(params?: { cursor?: string }): Promise<unknown>;
  getServerCapabilities(): unknown;
}

export interface McpSessionFactory {
  getSession(roomId: string, serverUrl: string): Promise<McpSession>;
}

export type CommandSuccessResponse =
  | {
      ok: true;
      revision: number;
      state: RoomState;
    }
  | {
      ok: true;
      accepted: true;
      invocationId: string;
      revision: number;
      state: RoomState;
    };

export interface IdempotencyRecord {
  commandHash: string;
  statusCode: number;
  response: CommandSuccessResponse;
}
