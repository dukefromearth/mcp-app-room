import { HttpError } from "../errors";
import type { RoomConfigInstance, RoomConfigUpsertInput } from "./types";

export interface RoomConfigSaveEnvelope {
  namespace: string;
  configId: string;
  owner?: string;
  visibility: RoomConfigUpsertInput["visibility"];
  title?: string;
  description?: string;
  tags?: string[];
}

export interface RoomStateSnapshotForConfig {
  order: string[];
  selectedInstanceId: string | null;
  mounts: Array<{
    instanceId: string;
    server: string;
    container: RoomConfigInstance["container"];
    uiResourceUri?: string;
    visible: boolean;
  }>;
}

export function buildRoomConfigUpsertFromRoomState(
  envelope: RoomConfigSaveEnvelope,
  state: RoomStateSnapshotForConfig,
): RoomConfigUpsertInput {
  const mountsById = new Map(
    state.mounts.map((mount) => [mount.instanceId, mount]),
  );
  const instances: RoomConfigInstance[] = state.order.map((instanceId) => {
    const mount = mountsById.get(instanceId);
    if (!mount) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        `Cannot derive room config: order references unknown mount ${instanceId}`,
      );
    }
    return {
      instanceId: mount.instanceId,
      server: mount.server,
      container: mount.container,
      ...(mount.uiResourceUri ? { uiResourceUri: mount.uiResourceUri } : {}),
      ...(mount.visible ? {} : { visible: false }),
    };
  });

  return {
    namespace: envelope.namespace,
    configId: envelope.configId,
    ...(envelope.owner ? { owner: envelope.owner } : {}),
    visibility: envelope.visibility,
    spec: {
      schemaVersion: "room-config.v1",
      ...(envelope.title ? { title: envelope.title } : {}),
      ...(envelope.description ? { description: envelope.description } : {}),
      ...(envelope.tags ? { tags: envelope.tags } : {}),
      instances,
      order: [...state.order],
      selectedInstanceId: state.selectedInstanceId,
    },
  };
}
