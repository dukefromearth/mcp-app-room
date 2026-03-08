import type { SidebarMountTool } from "../dev-sidebar/contracts";
import type { HostUiResourceCsp, HostUiResourcePermissions } from "../implementation";

export type LifecyclePhase =
  | "bridge_connected"
  | "resource_delivered"
  | "app_initialized"
  | "app_error";

export interface InstanceLifecycle {
  instanceId: string;
  mountNonce: string;
  sessionId: string;
  phase: LifecyclePhase;
  seq: number;
  updatedAt: string;
  lastError?: string;
}

export interface RoomLifecycle {
  instances: InstanceLifecycle[];
}

export interface InstanceAssurance {
  instanceId: string;
  level: "control_plane_ok" | "ui_bridge_connected" | "ui_resource_delivered" | "ui_app_initialized";
  proven: string[];
  unknown: string[];
}

export interface RoomAssurance {
  generatedAt: string;
  instances: InstanceAssurance[];
}

export interface RoomMount {
  instanceId: string;
  mountNonce: string;
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
  lifecycle: RoomLifecycle;
  assurance: RoomAssurance;
}

export interface RoomEvent {
  state: RoomState;
  revision: number;
  type: "state-updated" | "snapshot-reset";
}

export interface HostConfig {
  roomdUrl: string;
  roomId: string;
  roomConfigId?: string;
  roomConfigNamespace?: string;
}

export interface UiResource {
  uiResourceUri: string;
  html: string;
  csp?: HostUiResourceCsp;
  permissions?: HostUiResourcePermissions;
}
