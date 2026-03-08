import { cloneUnknown } from "./parsing";
import type {
  RoomEvidence,
  RoomEvidenceEvent,
  RoomEvidenceSource,
  RoomMount,
  RoomState,
} from "../types";

interface AppendEvidencePayload {
  source: RoomEvidenceSource;
  event: RoomEvidenceEvent;
  instanceId?: string;
  invocationId?: string;
  details?: Record<string, unknown>;
}

interface AppendRoomEvidenceInput {
  evidence: RoomEvidence[];
  evidenceCounter: number;
  evidenceHistoryLimit: number;
  revision: number;
  payload: AppendEvidencePayload;
}

export function appendRoomEvidence({
  evidence,
  evidenceCounter,
  evidenceHistoryLimit,
  revision,
  payload,
}: AppendRoomEvidenceInput): number {
  evidence.push({
    evidenceId: `ev-${revision}-${evidenceCounter}`,
    revision,
    timestamp: new Date().toISOString(),
    source: payload.source,
    event: payload.event,
    instanceId: payload.instanceId,
    invocationId: payload.invocationId,
    details: payload.details
      ? (cloneUnknown(payload.details) as Record<string, unknown>)
      : undefined,
  });

  while (evidence.length > evidenceHistoryLimit) {
    evidence.shift();
  }

  return evidenceCounter + 1;
}

export function buildRoomAssurance(
  mounts: RoomMount[],
  evidence: RoomEvidence[],
): RoomState["assurance"] {
  const byInstance = new Map<string, RoomEvidence[]>();
  for (const item of evidence) {
    if (!item.instanceId) {
      continue;
    }
    const items = byInstance.get(item.instanceId) ?? [];
    items.push(item);
    byInstance.set(item.instanceId, items);
  }

  const instances = mounts.map((mount) => {
    const instanceEvidence = byInstance.get(mount.instanceId) ?? [];
    const hasBridge = instanceEvidence.some((item) => item.event === "bridge_connected");
    const hasResource = instanceEvidence.some((item) => item.event === "resource_delivered");
    const hasInitialized = instanceEvidence.some((item) => item.event === "app_initialized");
    const hasAppError = instanceEvidence.some((item) => item.event === "app_error");

    let level: RoomState["assurance"]["instances"][number]["level"] = "control_plane_ok";
    if (hasBridge) {
      level = "ui_bridge_connected";
    }
    if (hasResource) {
      level = "ui_resource_delivered";
    }
    if (hasInitialized) {
      level = "ui_app_initialized";
    }

    const proven = ["Control-plane mount exists and is addressable."];
    if (hasBridge) {
      proven.push("Host bridge connected to sandbox transport.");
    }
    if (hasResource) {
      proven.push("Host delivered UI resource payload to sandbox.");
    }
    if (hasInitialized) {
      proven.push("App signaled initialization through protocol callback.");
    }

    const unknown: string[] = [];
    if (!hasInitialized) {
      unknown.push("User-visible render completeness is unknown.");
    }
    if (hasAppError) {
      unknown.push("App reported a runtime error; current visible state may differ.");
    }

    return {
      instanceId: mount.instanceId,
      level,
      proven,
      unknown,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    instances,
  };
}
