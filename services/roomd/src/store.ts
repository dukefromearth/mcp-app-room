import type { CommandEnvelope } from "./types";
import { stableStringify } from "./hash";
import type {
  CommandSuccessResponse,
  IdempotencyRecord,
  McpSession,
  McpSessionFactory,
  RoomCommand,
  RoomEvent,
  RoomInvocation,
  RoomMount,
  RoomState,
  ToolUiResource,
} from "./types";

interface RoomRuntime {
  roomId: string;
  revision: number;
  mounts: Map<string, RoomMount>;
  order: string[];
  selectedInstanceId: string | null;
  invocations: Map<string, RoomInvocation>;
  invocationOrder: string[];
  idempotency: Map<string, IdempotencyRecord>;
  events: RoomEvent[];
  subscribers: Set<(event: RoomEvent) => void>;
}

interface RoomStoreOptions {
  eventWindowSize?: number;
  invocationHistoryLimit?: number;
  idempotencyKeyLimit?: number;
  serverAllowlist?: string[];
}

interface CommandExecutionResult {
  statusCode: number;
  response: CommandSuccessResponse;
}

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomRuntime>();
  private invocationCounter = 1;

  private readonly eventWindowSize: number;
  private readonly invocationHistoryLimit: number;
  private readonly idempotencyKeyLimit: number;
  private readonly serverAllowlist: string[];

  constructor(
    private readonly sessionFactory: McpSessionFactory,
    options: RoomStoreOptions = {},
  ) {
    this.eventWindowSize = options.eventWindowSize ?? 500;
    this.invocationHistoryLimit = options.invocationHistoryLimit ?? 200;
    this.idempotencyKeyLimit = options.idempotencyKeyLimit ?? 1000;
    this.serverAllowlist = options.serverAllowlist ?? [];
  }

  createRoom(roomId: string): RoomState {
    if (this.rooms.has(roomId)) {
      throw new HttpError(409, `Room already exists: ${roomId}`);
    }

    const room: RoomRuntime = {
      roomId,
      revision: 0,
      mounts: new Map(),
      order: [],
      selectedInstanceId: null,
      invocations: new Map(),
      invocationOrder: [],
      idempotency: new Map(),
      events: [],
      subscribers: new Set(),
    };

    this.rooms.set(roomId, room);
    return this.buildState(room);
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  getState(roomId: string): RoomState {
    const room = this.requireRoom(roomId);
    return this.buildState(room);
  }

  subscribe(
    roomId: string,
    onEvent: (event: RoomEvent) => void,
  ): () => void {
    const room = this.requireRoom(roomId);
    room.subscribers.add(onEvent);
    return () => {
      room.subscribers.delete(onEvent);
    };
  }

  getReplayEvents(roomId: string, sinceRevision?: number): RoomEvent[] {
    const room = this.requireRoom(roomId);
    const state = this.buildState(room);

    if (sinceRevision === undefined) {
      return [
        {
          type: "snapshot-reset",
          reason: "subscriber-init",
          revision: state.revision,
          state,
        },
      ];
    }

    if (sinceRevision >= room.revision) {
      return [];
    }

    const firstEventRevision = room.events[0]?.revision;
    if (
      firstEventRevision === undefined ||
      sinceRevision < firstEventRevision - 1
    ) {
      return [
        {
          type: "snapshot-reset",
          reason: "replay-window-miss",
          revision: state.revision,
          state,
        },
      ];
    }

    return room.events.filter((event) => event.revision > sinceRevision);
  }

  async applyCommand(
    roomId: string,
    envelope: CommandEnvelope,
  ): Promise<CommandExecutionResult> {
    const room = this.requireRoom(roomId);

    const commandHash = stableStringify(envelope.command);
    const existing = room.idempotency.get(envelope.idempotencyKey);

    if (existing) {
      if (existing.commandHash !== commandHash) {
        throw new HttpError(409, "Idempotency key reused with different payload");
      }
      return {
        statusCode: existing.statusCode,
        response: existing.response,
      };
    }

    const result = await this.executeCommand(room, envelope.command);

    room.idempotency.set(envelope.idempotencyKey, {
      commandHash,
      statusCode: result.statusCode,
      response: result.response,
    });

    while (room.idempotency.size > this.idempotencyKeyLimit) {
      const firstKey = room.idempotency.keys().next().value as string | undefined;
      if (!firstKey) {
        break;
      }
      room.idempotency.delete(firstKey);
    }

    return result;
  }

  async getInstanceUiResource(
    roomId: string,
    instanceId: string,
  ): Promise<ToolUiResource> {
    const room = this.requireRoom(roomId);
    const mount = this.requireMount(room, instanceId);
    const session = await this.getSession(roomId, mount.server);

    let uiResourceUri = mount.uiResourceUri;
    if (!uiResourceUri) {
      const info = await session.listToolInfo(mount.toolName);
      uiResourceUri = info.uiResourceUri;
      if (uiResourceUri) {
        mount.uiResourceUri = uiResourceUri;
        this.commit(room, "resolve-ui-uri");
      }
    }

    if (!uiResourceUri) {
      throw new HttpError(
        404,
        `No UI resource URI available for instance ${instanceId}`,
      );
    }

    return session.readUiResource(uiResourceUri);
  }

  async getInstanceCapabilities(
    roomId: string,
    instanceId: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.getServerCapabilities();
  }

  async callInstanceTool(
    roomId: string,
    instanceId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.callTool(name, input);
  }

  async listInstanceResources(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.listResources({ cursor });
  }

  async readInstanceResource(
    roomId: string,
    instanceId: string,
    uri: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.readResource({ uri });
  }

  async listInstanceResourceTemplates(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.listResourceTemplates({ cursor });
  }

  async listInstancePrompts(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const session = await this.getSession(roomId, mount.server);
    return session.listPrompts({ cursor });
  }

  private async executeCommand(
    room: RoomRuntime,
    command: RoomCommand,
  ): Promise<CommandExecutionResult> {
    switch (command.type) {
      case "mount":
        return this.handleMount(room, command);
      case "hide":
        return this.handleVisibility(room, command.instanceId, false, "hide");
      case "show":
        return this.handleVisibility(room, command.instanceId, true, "show");
      case "unmount":
        return this.handleUnmount(room, command.instanceId);
      case "call":
        return this.handleCall(room, command.instanceId, command.input ?? {});
      case "select":
        return this.handleSelect(room, command.instanceId);
      case "reorder":
        return this.handleReorder(room, command.order);
      default:
        throw new HttpError(400, `Unsupported command type: ${String(command)}`);
    }
  }

  private async handleMount(
    room: RoomRuntime,
    command: Extract<RoomCommand, { type: "mount" }>,
  ): Promise<CommandExecutionResult> {
    if (room.mounts.has(command.instanceId)) {
      throw new HttpError(409, `Instance already mounted: ${command.instanceId}`);
    }

    this.assertServerAllowed(command.server);
    const session = await this.getSession(room.roomId, command.server);
    const toolInfo = await session.listToolInfo(command.toolName);

    const mount: RoomMount = {
      instanceId: command.instanceId,
      server: command.server,
      toolName: command.toolName,
      uiResourceUri: toolInfo.uiResourceUri,
      visible: true,
      container: command.container,
    };

    room.mounts.set(mount.instanceId, mount);
    room.order.push(mount.instanceId);
    room.selectedInstanceId = mount.instanceId;

    let invocationId: string | undefined;
    if (command.initialInput) {
      const invocation = this.createInvocation(mount, command.initialInput);
      invocationId = invocation.invocationId;
      this.insertInvocation(room, invocation);
    }

    const state = this.commit(room, "mount");

    if (invocationId) {
      this.startInvocation(room.roomId, invocationId).catch(() => {
        // Async failure is reflected in room state by startInvocation.
      });
    }

    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
  }

  private handleVisibility(
    room: RoomRuntime,
    instanceId: string,
    visible: boolean,
    reason: "hide" | "show",
  ): CommandExecutionResult {
    const mount = this.requireMount(room, instanceId);

    if (mount.visible === visible) {
      return {
        statusCode: 200,
        response: {
          ok: true,
          revision: room.revision,
          state: this.buildState(room),
        },
      };
    }

    mount.visible = visible;
    const state = this.commit(room, reason);

    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
  }

  private handleUnmount(
    room: RoomRuntime,
    instanceId: string,
  ): CommandExecutionResult {
    this.requireMount(room, instanceId);

    room.mounts.delete(instanceId);
    room.order = room.order.filter((id) => id !== instanceId);

    if (room.selectedInstanceId === instanceId) {
      room.selectedInstanceId = null;
    }

    const removedInvocationIds = room.invocationOrder.filter((id) => {
      const invocation = room.invocations.get(id);
      return invocation?.instanceId === instanceId;
    });

    for (const invocationId of removedInvocationIds) {
      room.invocations.delete(invocationId);
    }
    room.invocationOrder = room.invocationOrder.filter(
      (id) => !removedInvocationIds.includes(id),
    );

    const state = this.commit(room, "unmount");

    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
  }

  private handleSelect(
    room: RoomRuntime,
    instanceId: string | null,
  ): CommandExecutionResult {
    if (instanceId !== null && !room.mounts.has(instanceId)) {
      throw new HttpError(404, `Unknown instance: ${instanceId}`);
    }

    if (room.selectedInstanceId === instanceId) {
      return {
        statusCode: 200,
        response: {
          ok: true,
          revision: room.revision,
          state: this.buildState(room),
        },
      };
    }

    room.selectedInstanceId = instanceId;
    const state = this.commit(room, "select");
    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
  }

  private handleReorder(
    room: RoomRuntime,
    order: string[],
  ): CommandExecutionResult {
    if (new Set(order).size !== order.length) {
      throw new HttpError(400, "Reorder command contains duplicate instance ids");
    }

    const currentIds = new Set(room.mounts.keys());
    if (order.length !== currentIds.size) {
      throw new HttpError(400, "Reorder command must include every mounted instance");
    }

    for (const instanceId of order) {
      if (!currentIds.has(instanceId)) {
        throw new HttpError(400, `Unknown instance in reorder: ${instanceId}`);
      }
    }

    if (
      order.length === room.order.length &&
      order.every((id, idx) => id === room.order[idx])
    ) {
      return {
        statusCode: 200,
        response: {
          ok: true,
          revision: room.revision,
          state: this.buildState(room),
        },
      };
    }

    room.order = [...order];
    const state = this.commit(room, "reorder");
    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
  }

  private handleCall(
    room: RoomRuntime,
    instanceId: string,
    input: Record<string, unknown>,
  ): CommandExecutionResult {
    const mount = this.requireMount(room, instanceId);
    const invocation = this.createInvocation(mount, input);

    this.insertInvocation(room, invocation);
    room.selectedInstanceId = instanceId;
    const state = this.commit(room, "call");

    this.startInvocation(room.roomId, invocation.invocationId).catch(() => {
      // Async failure is reflected in room state by startInvocation.
    });

    return {
      statusCode: 202,
      response: {
        ok: true,
        accepted: true,
        invocationId: invocation.invocationId,
        revision: state.revision,
        state,
      },
    };
  }

  private async startInvocation(
    roomId: string,
    invocationId: string,
  ): Promise<void> {
    const room = this.requireRoom(roomId);
    const invocation = room.invocations.get(invocationId);
    if (!invocation) {
      return;
    }

    const session = await this.getSession(roomId, invocation.server);

    try {
      const result = await session.callTool(invocation.toolName, invocation.input);
      const currentRoom = this.requireRoom(roomId);
      const current = currentRoom.invocations.get(invocationId);
      if (!current) {
        return;
      }
      current.status = "completed";
      current.result = result;
      current.error = undefined;
      this.commit(currentRoom, "call-result");
    } catch (error) {
      const currentRoom = this.requireRoom(roomId);
      const current = currentRoom.invocations.get(invocationId);
      if (!current) {
        return;
      }
      current.status = "failed";
      current.error = error instanceof Error ? error.message : String(error);
      this.commit(currentRoom, "call-failed");
    }
  }

  private insertInvocation(room: RoomRuntime, invocation: RoomInvocation): void {
    room.invocations.set(invocation.invocationId, invocation);
    room.invocationOrder.push(invocation.invocationId);

    while (room.invocationOrder.length > this.invocationHistoryLimit) {
      const oldId = room.invocationOrder.shift();
      if (oldId) {
        room.invocations.delete(oldId);
      }
    }
  }

  private createInvocation(
    mount: RoomMount,
    input: Record<string, unknown>,
  ): RoomInvocation {
    const invocationId = `inv-${Date.now()}-${this.invocationCounter++}`;
    return {
      invocationId,
      instanceId: mount.instanceId,
      server: mount.server,
      toolName: mount.toolName,
      input,
      status: "running",
    };
  }

  private commit(
    room: RoomRuntime,
    reason: Extract<RoomEvent, { type: "state-updated" }>['reason'],
  ): RoomState {
    room.revision += 1;
    const state = this.buildState(room);
    const event: RoomEvent = {
      type: "state-updated",
      revision: room.revision,
      reason,
      state,
    };

    room.events.push(event);
    while (room.events.length > this.eventWindowSize) {
      room.events.shift();
    }

    for (const subscriber of room.subscribers) {
      subscriber(event);
    }

    return state;
  }

  private buildState(room: RoomRuntime): RoomState {
    const mounts = room.order
      .map((instanceId) => room.mounts.get(instanceId))
      .filter((mount): mount is RoomMount => !!mount)
      .map((mount) => ({ ...mount, container: { ...mount.container } }));

    const invocations = room.invocationOrder
      .map((id) => room.invocations.get(id))
      .filter((invocation): invocation is RoomInvocation => !!invocation)
      .map((invocation) => ({ ...invocation, input: { ...invocation.input } }));

    return {
      roomId: room.roomId,
      revision: room.revision,
      mounts,
      order: [...room.order],
      selectedInstanceId: room.selectedInstanceId,
      invocations,
    };
  }

  private getInstanceMount(roomId: string, instanceId: string): RoomMount {
    const room = this.requireRoom(roomId);
    return this.requireMount(room, instanceId);
  }

  private requireRoom(roomId: string): RoomRuntime {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new HttpError(404, `Room not found: ${roomId}`);
    }
    return room;
  }

  private requireMount(room: RoomRuntime, instanceId: string): RoomMount {
    const mount = room.mounts.get(instanceId);
    if (!mount) {
      throw new HttpError(404, `Instance not found: ${instanceId}`);
    }
    return mount;
  }

  private async getSession(roomId: string, serverUrl: string): Promise<McpSession> {
    return this.sessionFactory.getSession(roomId, serverUrl);
  }

  private assertServerAllowed(serverUrl: string): void {
    if (this.serverAllowlist.length === 0) {
      return;
    }

    const allowed = this.serverAllowlist.some((prefix) =>
      serverUrl.startsWith(prefix),
    );

    if (!allowed) {
      throw new HttpError(403, `Server URL is not allowlisted: ${serverUrl}`);
    }
  }
}
