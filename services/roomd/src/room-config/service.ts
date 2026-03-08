import { HttpError } from "../errors";
import { RoomStore } from "../store";
import type { RoomState } from "../types";
import { buildRoomConfigUpsertFromRoomState } from "./from-room-state";
import type { RoomConfigRepository } from "./repository";
import { assertValidRoomConfigSpec, orderRoomConfigInstances } from "./spec";
import { NoopRoomConfigTelemetry } from "./telemetry";
import type { RoomConfigTelemetry } from "./telemetry";
import { getRoomdLogger, serializeError } from "../logging";
import type {
  RoomConfigLoadPlan,
  RoomConfigPlanOperation,
  RoomConfigLoadInput,
  RoomConfigLoadResult,
  RoomConfigPlanInput,
  RoomConfigRecord,
  RoomConfigUpsertInput,
} from "./types";

interface RoomConfigServiceOptions {
  telemetry?: RoomConfigTelemetry;
}

interface ResolvedLoadPlan {
  config: RoomConfigRecord;
  plan: RoomConfigLoadPlan;
}

export class RoomConfigService {
  private readonly telemetry: RoomConfigTelemetry;
  private readonly logger = getRoomdLogger({ component: "room_config_service" });

  constructor(
    private readonly repository: RoomConfigRepository,
    private readonly store: RoomStore,
    options: RoomConfigServiceOptions = {},
  ) {
    this.telemetry = options.telemetry ?? new NoopRoomConfigTelemetry();
  }

  async list(namespace: string): Promise<RoomConfigRecord[]> {
    const configs = await this.repository.list(namespace);
    return configs;
  }

  async get(namespace: string, configId: string): Promise<RoomConfigRecord | null> {
    const config = await this.repository.get(namespace, configId);
    return config;
  }

  async upsert(input: RoomConfigUpsertInput): Promise<RoomConfigRecord> {
    return this.persistUpsert("upsert", input);
  }

  async saveFromRoomState(input: {
    namespace: string;
    roomId: string;
    configId: string;
    owner?: string;
    visibility: RoomConfigUpsertInput["visibility"];
    title?: string;
    description?: string;
    tags?: string[];
  }): Promise<RoomConfigRecord> {
    this.logger.info("saveFromRoomState.enter", {
      namespace: input.namespace,
      roomId: input.roomId,
      configId: input.configId,
    });
    const state = this.store.getState(input.roomId);
    const upsertInput = buildRoomConfigUpsertFromRoomState(
      {
        namespace: input.namespace,
        configId: input.configId,
        ...(input.owner ? { owner: input.owner } : {}),
        visibility: input.visibility,
        ...(input.title ? { title: input.title } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      },
      state,
    );
    const record = await this.persistUpsert("save", upsertInput, input.roomId);
    this.logger.info("saveFromRoomState.exit", {
      namespace: input.namespace,
      roomId: input.roomId,
      configId: input.configId,
      revision: record.revision,
    });
    return record;
  }

  async planLoad(input: RoomConfigPlanInput): Promise<ResolvedLoadPlan> {
    this.logger.info("planLoad.enter", {
      namespace: input.namespace,
      configId: input.configId,
      roomId: input.roomId,
      mode: input.mode,
    });
    const config = await this.repository.get(input.namespace, input.configId);
    if (!config) {
      throw new HttpError(
        404,
        "CONFIG_NOT_FOUND",
        `Unknown room configuration: ${input.namespace}/${input.configId}`,
      );
    }

    assertValidRoomConfigSpec(config.spec);
    this.assertMode(input.mode);
    const state = this.snapshotRoomState(input.roomId);
    if (input.mode === "empty_only" && state.mounts.length > 0) {
      throw new HttpError(
        409,
        "ROOM_NOT_EMPTY",
        `Room must be empty before applying configuration in empty_only mode: ${input.roomId}`,
      );
    }

    const instancesInApplyOrder = orderRoomConfigInstances(config.spec);
    const operations: RoomConfigPlanOperation[] = [];
    for (const mount of instancesInApplyOrder) {
      operations.push({
        type: "mount",
        instanceId: mount.instanceId,
        server: mount.server,
        container: mount.container,
        ...(mount.uiResourceUri ? { uiResourceUri: mount.uiResourceUri } : {}),
        visible: mount.visible !== false,
        hasClientCapabilitiesPatch: !!mount.clientCapabilities,
      });
      if (mount.visible === false) {
        operations.push({
          type: "hide",
          instanceId: mount.instanceId,
        });
      }
    }

    if (config.spec.selectedInstanceId !== undefined) {
      operations.push({
        type: "select",
        instanceId: config.spec.selectedInstanceId,
      });
    }

    const targetSelectedInstanceId = config.spec.selectedInstanceId !== undefined
      ? config.spec.selectedInstanceId
      : instancesInApplyOrder[instancesInApplyOrder.length - 1]?.instanceId ?? null;

    const resolvedPlan = {
      config,
      plan: {
        operations,
        summary: {
          currentMountCount: state.mounts.length,
          targetMountCount: instancesInApplyOrder.length,
          currentSelectedInstanceId: state.selectedInstanceId,
          targetSelectedInstanceId,
        },
      },
    };
    this.logger.info("planLoad.exit", {
      namespace: input.namespace,
      configId: input.configId,
      roomId: input.roomId,
      operations: resolvedPlan.plan.operations.length,
    });
    return resolvedPlan;
  }

  async loadIntoRoom(input: RoomConfigLoadInput): Promise<RoomConfigLoadResult> {
    this.logger.info("loadIntoRoom.enter", {
      namespace: input.namespace,
      configId: input.configId,
      roomId: input.roomId,
      mode: input.mode,
      dryRun: input.dryRun,
    });
    try {
      const resolved = await this.planLoad({
        namespace: input.namespace,
        configId: input.configId,
        roomId: input.roomId,
        mode: input.mode,
      });
      await this.preflightOperations(resolved.plan.operations);

      if (input.dryRun) {
        this.recordSuccess("load", {
          namespace: input.namespace,
          configId: input.configId,
          roomId: input.roomId,
          mode: input.mode,
          dryRun: true,
          revision: resolved.config.revision,
          plannedCommands: resolved.plan.operations.length,
        });
        return {
          ok: true,
          applied: false,
          dryRun: true,
          roomId: input.roomId,
          mode: input.mode,
          namespace: input.namespace,
          configId: input.configId,
          revision: resolved.config.revision,
          plannedCommands: resolved.plan.operations.length,
          plan: resolved.plan,
        };
      }

      if (!this.store.hasRoom(input.roomId)) {
        this.store.createRoom(input.roomId);
      }

      for (let idx = 0; idx < resolved.plan.operations.length; idx += 1) {
        const operation = resolved.plan.operations[idx]!;
        switch (operation.type) {
          case "mount": {
            const mount = resolved.config.spec.instances.find(
              (candidate) => candidate.instanceId === operation.instanceId,
            );
            if (!mount) {
              throw new HttpError(
                400,
                "INVALID_COMMAND",
                `Room configuration instance missing during load: ${operation.instanceId}`,
              );
            }
            await this.store.applyCommand(input.roomId, {
              idempotencyKey: `${input.idempotencyKey}:mount:${idx}:${mount.instanceId}`,
              command: {
                type: "mount",
                instanceId: mount.instanceId,
                server: mount.server,
                container: mount.container,
                ...(mount.uiResourceUri ? { uiResourceUri: mount.uiResourceUri } : {}),
                ...(mount.clientCapabilities
                  ? { clientCapabilities: mount.clientCapabilities }
                  : {}),
              },
            });
            break;
          }
          case "hide":
            await this.store.applyCommand(input.roomId, {
              idempotencyKey: `${input.idempotencyKey}:hide:${idx}:${operation.instanceId}`,
              command: {
                type: "hide",
                instanceId: operation.instanceId,
              },
            });
            break;
          case "select":
            await this.store.applyCommand(input.roomId, {
              idempotencyKey: `${input.idempotencyKey}:select:${idx}`,
              command: {
                type: "select",
                instanceId: operation.instanceId,
              },
            });
            break;
          default:
            break;
        }
      }

      const finalState = this.store.getState(input.roomId);
      this.recordSuccess("load", {
        namespace: input.namespace,
        configId: input.configId,
        roomId: input.roomId,
        mode: input.mode,
        dryRun: false,
        revision: resolved.config.revision,
        plannedCommands: resolved.plan.operations.length,
      });
      return {
        ok: true,
        applied: true,
        dryRun: false,
        roomId: input.roomId,
        mode: input.mode,
        namespace: input.namespace,
        configId: input.configId,
        revision: resolved.config.revision,
        plannedCommands: resolved.plan.operations.length,
        plan: resolved.plan,
        state: finalState,
      };
    } catch (error) {
      this.logger.debug("loadIntoRoom.error", {
        namespace: input.namespace,
        configId: input.configId,
        roomId: input.roomId,
        error: serializeError(error),
      });
      this.recordFailure("load", {
        namespace: input.namespace,
        configId: input.configId,
        roomId: input.roomId,
        mode: input.mode,
        dryRun: input.dryRun,
      }, error);
      throw error;
    }
  }

  private async preflightOperations(
    operations: RoomConfigPlanOperation[],
  ): Promise<void> {
    const seenServers = new Set<string>();
    for (const operation of operations) {
      if (operation.type !== "mount") {
        continue;
      }
      if (seenServers.has(operation.server)) {
        continue;
      }
      seenServers.add(operation.server);
      await this.store.inspectServer(operation.server);
    }
  }

  private snapshotRoomState(roomId: string): Pick<RoomState, "mounts" | "selectedInstanceId"> {
    if (!this.store.hasRoom(roomId)) {
      return {
        mounts: [],
        selectedInstanceId: null,
      };
    }
    const state = this.store.getState(roomId);
    return {
      mounts: state.mounts,
      selectedInstanceId: state.selectedInstanceId,
    };
  }

  private assertMode(mode: RoomConfigLoadInput["mode"]): void {
    if (mode !== "empty_only") {
      throw new HttpError(400, "INVALID_COMMAND", `Unsupported load mode: ${mode}`);
    }
  }

  private async persistUpsert(
    action: "upsert" | "save",
    input: RoomConfigUpsertInput,
    roomId?: string,
  ): Promise<RoomConfigRecord> {
    assertValidRoomConfigSpec(input.spec);
    try {
      const record = await this.repository.upsert(input);
      this.recordSuccess(action, {
        namespace: input.namespace,
        configId: input.configId,
        roomId,
        revision: record.revision,
      });
      return record;
    } catch (error) {
      this.recordFailure(action, {
        namespace: input.namespace,
        configId: input.configId,
        roomId,
      }, error);
      throw error;
    }
  }

  private recordSuccess(
    action: "upsert" | "load" | "save",
    payload: {
      namespace: string;
      configId: string;
      roomId?: string;
      mode?: string;
      dryRun?: boolean;
      revision?: number;
      plannedCommands?: number;
    },
  ): void {
    this.telemetry.increment("room_config_requests_total", {
      action,
      status: "ok",
      ...(payload.mode ? { mode: payload.mode } : {}),
      ...(payload.dryRun !== undefined ? { dryRun: payload.dryRun } : {}),
      namespace: payload.namespace,
    });
    this.telemetry.record({
      action,
      status: "ok",
      namespace: payload.namespace,
      configId: payload.configId,
      ...(payload.roomId ? { roomId: payload.roomId } : {}),
      ...(payload.mode ? { mode: payload.mode } : {}),
      ...(payload.dryRun !== undefined ? { dryRun: payload.dryRun } : {}),
      ...(payload.revision !== undefined ? { revision: payload.revision } : {}),
      ...(payload.plannedCommands !== undefined
        ? { plannedCommands: payload.plannedCommands }
        : {}),
      timestamp: new Date().toISOString(),
    });
  }

  private recordFailure(
    action: "upsert" | "load" | "save",
    payload: {
      namespace: string;
      configId: string;
      roomId?: string;
      mode?: string;
      dryRun?: boolean;
    },
    error: unknown,
  ): void {
    this.telemetry.increment("room_config_requests_total", {
      action,
      status: "error",
      ...(payload.mode ? { mode: payload.mode } : {}),
      ...(payload.dryRun !== undefined ? { dryRun: payload.dryRun } : {}),
      namespace: payload.namespace,
    });

    const details = this.mapError(error);
    this.telemetry.record({
      action,
      status: "error",
      namespace: payload.namespace,
      configId: payload.configId,
      ...(payload.roomId ? { roomId: payload.roomId } : {}),
      ...(payload.mode ? { mode: payload.mode } : {}),
      ...(payload.dryRun !== undefined ? { dryRun: payload.dryRun } : {}),
      ...(details.code ? { code: details.code } : {}),
      ...(details.message ? { message: details.message } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  private mapError(error: unknown): { code?: string; message?: string } {
    if (error instanceof HttpError) {
      return { code: error.code, message: error.message };
    }
    if (error instanceof Error) {
      return { message: error.message };
    }
    return {};
  }
}
