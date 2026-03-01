import { HttpError } from "../errors";
import type { RoomConfigInstance, RoomConfigSpecV1 } from "./types";

export function assertValidRoomConfigSpec(spec: RoomConfigSpecV1): void {
  if (spec.instances.length === 0) {
    throw new HttpError(
      400,
      "INVALID_COMMAND",
      "Room configuration must include at least one instance",
    );
  }

  const instancesById = new Map<string, RoomConfigInstance>();
  for (const instance of spec.instances) {
    if (instancesById.has(instance.instanceId)) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        `Room configuration has duplicate instanceId: ${instance.instanceId}`,
      );
    }
    instancesById.set(instance.instanceId, instance);
  }

  if (spec.order) {
    if (new Set(spec.order).size !== spec.order.length) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        "Room configuration order contains duplicate instance IDs",
      );
    }

    if (spec.order.length !== spec.instances.length) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        "Room configuration order must include every instance exactly once",
      );
    }

    for (const instanceId of spec.order) {
      if (!instancesById.has(instanceId)) {
        throw new HttpError(
          400,
          "INVALID_COMMAND",
          `Room configuration order references unknown instance: ${instanceId}`,
        );
      }
    }
  }

  if (
    spec.selectedInstanceId !== undefined &&
    spec.selectedInstanceId !== null &&
    !instancesById.has(spec.selectedInstanceId)
  ) {
    throw new HttpError(
      400,
      "INVALID_COMMAND",
      `Room configuration selectedInstanceId does not exist: ${spec.selectedInstanceId}`,
    );
  }
}

export function orderRoomConfigInstances(spec: RoomConfigSpecV1): RoomConfigInstance[] {
  const instancesById = new Map(
    spec.instances.map((instance) => [instance.instanceId, instance]),
  );
  const order = spec.order ?? spec.instances.map((instance) => instance.instanceId);
  return order.map((instanceId) => {
    const instance = instancesById.get(instanceId);
    if (!instance) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        `Room configuration order references unknown instance: ${instanceId}`,
      );
    }
    return instance;
  });
}
