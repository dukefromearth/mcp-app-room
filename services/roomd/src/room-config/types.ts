import type {
  GridContainer,
  MountClientCapabilitiesConfig,
  RoomState,
} from "../types";

export type RoomConfigSchemaVersion = "room-config.v1";
export type RoomConfigVisibility = "private" | "shared";
export type RoomConfigLoadMode = "empty_only";

export interface RoomConfigInstance {
  instanceId: string;
  server: string;
  container: GridContainer;
  uiResourceUri?: string;
  visible?: boolean;
  clientCapabilities?: MountClientCapabilitiesConfig;
}

export interface RoomConfigSpecV1 {
  schemaVersion: "room-config.v1";
  title?: string;
  description?: string;
  tags?: string[];
  instances: RoomConfigInstance[];
  order?: string[];
  selectedInstanceId?: string | null;
}

export interface RoomConfigRecord {
  namespace: string;
  configId: string;
  owner?: string;
  visibility: RoomConfigVisibility;
  revision: number;
  schemaVersion: RoomConfigSchemaVersion;
  spec: RoomConfigSpecV1;
  createdAt: string;
  updatedAt: string;
}

export interface RoomConfigUpsertInput {
  namespace: string;
  configId: string;
  owner?: string;
  visibility: RoomConfigVisibility;
  spec: RoomConfigSpecV1;
}

export interface RoomConfigLoadInput {
  namespace: string;
  configId: string;
  roomId: string;
  mode: RoomConfigLoadMode;
  dryRun: boolean;
  idempotencyKey: string;
}

export interface RoomConfigPlanInput {
  namespace: string;
  configId: string;
  roomId: string;
  mode: RoomConfigLoadMode;
}

export interface RoomConfigPlanSummary {
  currentMountCount: number;
  targetMountCount: number;
  currentSelectedInstanceId: string | null;
  targetSelectedInstanceId: string | null;
}

export type RoomConfigPlanOperation =
  | {
      type: "mount";
      instanceId: string;
      server: string;
      container: GridContainer;
      uiResourceUri?: string;
      visible: boolean;
      hasClientCapabilitiesPatch: boolean;
    }
  | {
      type: "hide";
      instanceId: string;
    }
  | {
      type: "select";
      instanceId: string | null;
    };

export interface RoomConfigLoadPlan {
  operations: RoomConfigPlanOperation[];
  summary: RoomConfigPlanSummary;
}

export interface RoomConfigLoadResult {
  ok: true;
  applied: boolean;
  dryRun: boolean;
  roomId: string;
  mode: RoomConfigLoadMode;
  namespace: string;
  configId: string;
  revision: number;
  plannedCommands: number;
  plan: RoomConfigLoadPlan;
  state?: RoomState;
}
