import type { SidebarMountTool } from "../dev-sidebar/contracts";
import type { HostUiResourceCsp, HostUiResourcePermissions } from "../implementation";

export interface RoomMount {
  instanceId: string;
  server: string;
  uiResourceUri?: string;
  visible: boolean;
  container: { x: number; y: number; w: number; h: number };
  tools: SidebarMountTool[];
}

export interface RoomInvocation {
  invocationId: string;
  instanceId: string;
  toolName?: string;
  input: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

export interface RoomState {
  roomId: string;
  revision: number;
  order: string[];
  mounts: RoomMount[];
  selectedInstanceId: string | null;
  invocations: RoomInvocation[];
}

export interface RoomEvent {
  state: RoomState;
  revision: number;
  type: "state-updated" | "snapshot-reset";
}

export interface HostConfig {
  roomdUrl: string;
  roomId: string;
}

export interface UiResource {
  uiResourceUri: string;
  html: string;
  csp?: HostUiResourceCsp;
  permissions?: HostUiResourcePermissions;
}
