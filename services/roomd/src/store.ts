import type { CommandEnvelope } from "./types";
import { stableStringify } from "./hash";
import { ensureServerCapability, ensureServerCapabilityFeature } from "./capabilities";
import { HttpError } from "./errors";
import { normalizeServerTarget } from "./server-target";
import { ClientCapabilityRegistry } from "./client-capabilities/registry";
import { computeLayoutUpdate } from "./store/layout";
import {
  assertFileRootUris,
  buildExampleCommands,
  cloneMountTool,
  cloneNegotiatedSession,
  cloneUnknown,
  isUiCandidateResource,
  parseResourcesPage,
  parseToolsPage,
} from "./store/parsing";
import { assertServerAllowed as assertServerAllowedByPolicy } from "./store/server-policy";
import {
  buildAssuranceFromLifecycle,
  buildLifecycle,
  createMountNonce,
  transitionLifecycle,
  type RoomLifecycleRuntime,
} from "./store/lifecycle";
import { getRoomdLogger, serializeError } from "./logging";
import type {
  ClientRoot,
  CompletionCompleteParams,
  CommandSuccessResponse,
  ElicitationPreviewResult,
  GridContainer,
  IdempotencyRecord,
  InstanceClientCapabilitiesConfig,
  LayoutAdapterName,
  LayoutOp,
  LifecyclePhase,
  McpSession,
  McpSessionFactory,
  NegotiatedSession,
  PromptGetParams,
  ResourceSubscriptionParams,
  RoomCommand,
  RoomEvent,
  RoomInvocation,
  RoomMount,
  RoomMountTool,
  RoomState,
  SamplingPreviewResult,
  ServerInspection,
  ToolUiResource,
} from "./types";

export { HttpError } from "./errors";

interface RoomRuntime {
  roomId: string;
  revision: number;
  mounts: Map<string, RoomMount>;
  sessions: Map<string, NegotiatedSession>;
  order: string[];
  selectedInstanceId: string | null;
  invocations: Map<string, RoomInvocation>;
  invocationOrder: string[];
  idempotency: Map<string, IdempotencyRecord>;
  lifecycleByInstance: Map<string, RoomLifecycleRuntime>;
  lifecycleSessionIdsByInstance: Map<string, Set<string>>;
  events: RoomEvent[];
  subscribers: Set<(event: RoomEvent) => void>;
}

interface RoomStoreOptions {
  eventWindowSize?: number;
  invocationHistoryLimit?: number;
  idempotencyKeyLimit?: number;
  serverAllowlist?: string[];
  stdioCommandAllowlist?: string[];
  allowRemoteHttpServers?: boolean;
  remoteHttpOriginAllowlist?: string[];
  clientCapabilityRegistry?: ClientCapabilityRegistry;
}

interface CommandExecutionResult {
  statusCode: number;
  response: CommandSuccessResponse;
}

interface CreateRoomResult {
  state: RoomState;
  created: boolean;
}

interface ReportLifecycleResult {
  state: RoomState;
  accepted: "applied" | "duplicate";
}

const INSPECTION_ROOM_ID = "__inspect__";

export class RoomStore {
  private readonly rooms = new Map<string, RoomRuntime>();
  private invocationCounter = 1;
  private readonly logger = getRoomdLogger({ component: "room_store" });

  private readonly eventWindowSize: number;
  private readonly invocationHistoryLimit: number;
  private readonly idempotencyKeyLimit: number;
  private readonly serverAllowlist: string[];
  private readonly stdioCommandAllowlist: string[];
  private readonly allowRemoteHttpServers: boolean;
  private readonly remoteHttpOriginAllowlist: string[];
  private readonly clientCapabilityRegistry: ClientCapabilityRegistry;
  private mountNonceCounter = 1;

  constructor(
    private readonly sessionFactory: McpSessionFactory,
    options: RoomStoreOptions = {},
  ) {
    this.eventWindowSize = options.eventWindowSize ?? 500;
    this.invocationHistoryLimit = options.invocationHistoryLimit ?? 200;
    this.idempotencyKeyLimit = options.idempotencyKeyLimit ?? 1000;
    this.serverAllowlist = options.serverAllowlist ?? [];
    this.stdioCommandAllowlist = options.stdioCommandAllowlist ?? [];
    this.allowRemoteHttpServers = options.allowRemoteHttpServers ?? false;
    this.remoteHttpOriginAllowlist = options.remoteHttpOriginAllowlist ?? [];
    this.clientCapabilityRegistry =
      options.clientCapabilityRegistry ?? new ClientCapabilityRegistry();
  }

  createRoom(roomId: string): RoomState {
    return this.createRoomWithStatus(roomId).state;
  }

  createRoomWithStatus(roomId: string): CreateRoomResult {
    const existing = this.rooms.get(roomId);
    if (existing) {
      return {
        state: this.buildState(existing),
        created: false,
      };
    }

    const room: RoomRuntime = {
      roomId,
      revision: 0,
      mounts: new Map(),
      sessions: new Map(),
      order: [],
      selectedInstanceId: null,
      invocations: new Map(),
      invocationOrder: [],
      idempotency: new Map(),
      lifecycleByInstance: new Map(),
      lifecycleSessionIdsByInstance: new Map(),
      events: [],
      subscribers: new Set(),
    };

    this.rooms.set(roomId, room);
    return {
      state: this.buildState(room),
      created: true,
    };
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
    this.logger.info("applyCommand.enter", {
      roomId,
      commandType: envelope.command.type,
      idempotencyKey: envelope.idempotencyKey,
    });
    const room = this.requireRoom(roomId);

    const commandHash = stableStringify(envelope.command);
    const existing = room.idempotency.get(envelope.idempotencyKey);

    if (existing) {
      if (existing.commandHash !== commandHash) {
        throw new HttpError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key reused with different payload",
        );
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

    this.logger.info("applyCommand.exit", {
      roomId,
      commandType: envelope.command.type,
      statusCode: result.statusCode,
      idempotencySize: room.idempotency.size,
    });
    return result;
  }

  async getInstanceUiResource(
    roomId: string,
    instanceId: string,
  ): Promise<ToolUiResource> {
    const room = this.requireRoom(roomId);
    const mount = this.requireMount(room, instanceId);
    ensureServerCapability(mount.session, "resources", "resources/read");
    const session = await this.getSession(roomId, mount.server);

    if (!mount.uiResourceUri) {
      throw new HttpError(
        404,
        "NO_UI_RESOURCE",
        `Mounted instance ${instanceId} has no UI resource`,
      );
    }

    return session.readUiResource(mount.uiResourceUri);
  }

  async inspectServer(serverUrl: string): Promise<ServerInspection> {
    this.logger.info("inspectServer.enter", { serverUrl });
    const normalizedServer = normalizeServerTarget(serverUrl);
    this.assertServerAllowed(normalizedServer);
    try {
      const inspection = await this.inspectServerWithSession(
        INSPECTION_ROOM_ID,
        normalizedServer,
      );
      this.logger.info("inspectServer.exit", {
        serverUrl: normalizedServer,
        tools: inspection.tools.length,
        uiCandidates: inspection.uiCandidates.length,
      });
      return inspection;
    } finally {
      await this.sessionFactory.releaseSession(INSPECTION_ROOM_ID, normalizedServer);
    }
  }

  async getInstanceCapabilities(
    roomId: string,
    instanceId: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    return cloneUnknown(mount.session.capabilities);
  }

  async getInstanceClientCapabilities(
    roomId: string,
    instanceId: string,
  ): Promise<InstanceClientCapabilitiesConfig> {
    const mount = this.getInstanceMount(roomId, instanceId);
    return this.clientCapabilityRegistry.getSnapshot(roomId, mount.server);
  }

  async setInstanceRoots(
    roomId: string,
    instanceId: string,
    roots: ClientRoot[],
  ): Promise<InstanceClientCapabilitiesConfig> {
    assertFileRootUris(roots);
    const mount = this.getInstanceMount(roomId, instanceId);
    const config = this.clientCapabilityRegistry.setRoots(roomId, mount.server, roots);

    if (!config.roots.enabled) {
      throw new HttpError(
        400,
        "UNSUPPORTED_CAPABILITY",
        "Client roots capability is disabled for this instance",
      );
    }

    if (config.roots.listChanged) {
      const session = await this.getSession(roomId, mount.server);
      await session.notifyRootsListChanged();
    }

    return config;
  }

  async configureInstanceSampling(
    roomId: string,
    instanceId: string,
    patch: Partial<InstanceClientCapabilitiesConfig["sampling"]>,
  ): Promise<InstanceClientCapabilitiesConfig> {
    const mount = this.getInstanceMount(roomId, instanceId);
    return this.clientCapabilityRegistry.updateSampling(roomId, mount.server, patch);
  }

  async configureInstanceElicitation(
    roomId: string,
    instanceId: string,
    patch: Partial<InstanceClientCapabilitiesConfig["elicitation"]>,
  ): Promise<InstanceClientCapabilitiesConfig> {
    const mount = this.getInstanceMount(roomId, instanceId);
    return this.clientCapabilityRegistry.updateElicitation(roomId, mount.server, patch);
  }

  async previewInstanceSampling(
    roomId: string,
    instanceId: string,
    params: unknown,
  ): Promise<SamplingPreviewResult> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const config = this.clientCapabilityRegistry.getSnapshot(roomId, mount.server);
    if (!config.sampling.enabled) {
      throw new HttpError(
        400,
        "UNSUPPORTED_CAPABILITY",
        "Client sampling capability is disabled for this instance",
      );
    }

    return this.clientCapabilityRegistry.evaluateSampling(
      roomId,
      mount.server,
      params,
    );
  }

  async previewInstanceElicitation(
    roomId: string,
    instanceId: string,
    params: unknown,
  ): Promise<ElicitationPreviewResult> {
    const mount = this.getInstanceMount(roomId, instanceId);
    const config = this.clientCapabilityRegistry.getSnapshot(roomId, mount.server);
    if (!config.elicitation.enabled) {
      throw new HttpError(
        400,
        "UNSUPPORTED_CAPABILITY",
        "Client elicitation capability is disabled for this instance",
      );
    }

    return this.clientCapabilityRegistry.evaluateElicitation(
      roomId,
      mount.server,
      params,
    );
  }

  reportInstanceLifecycle(
    roomId: string,
    instanceId: string,
    mountNonce: string,
    sessionId: string,
    seq: number,
    phase: LifecyclePhase,
    details?: Record<string, unknown>,
  ): ReportLifecycleResult {
    const room = this.requireRoom(roomId);
    const mount = this.requireMount(room, instanceId);
    if (mount.mountNonce !== mountNonce) {
      throw new HttpError(
        409,
        "LIFECYCLE_STALE_MOUNT",
        `Stale lifecycle mount nonce for instance ${instanceId}`,
        {
          details: {
            expectedMountNonce: mount.mountNonce,
            receivedMountNonce: mountNonce,
          },
          hint: "Refresh room state and retry with the current mount nonce.",
        },
      );
    }

    const existing = room.lifecycleByInstance.get(instanceId);
    const knownSessions = room.lifecycleSessionIdsByInstance.get(instanceId) ?? new Set<string>();
    if (existing && existing.mountNonce !== mountNonce) {
      throw new HttpError(
        409,
        "LIFECYCLE_STALE_MOUNT",
        `Lifecycle stream is stale for instance ${instanceId}`,
        {
          details: {
            expectedMountNonce: existing.mountNonce,
            receivedMountNonce: mountNonce,
          },
        },
      );
    }
    const transition = transitionLifecycle(existing, {
      instanceId,
      mountNonce,
      sessionId,
      seq,
      phase,
      details,
    }, {
      knownSessionIds: knownSessions,
    });
    if (transition.accepted === "duplicate") {
      return {
        state: this.buildState(room),
        accepted: "duplicate",
      };
    }
    room.lifecycleByInstance.set(instanceId, transition.next);
    knownSessions.add(sessionId);
    room.lifecycleSessionIdsByInstance.set(instanceId, knownSessions);
    const state = this.commit(room, "lifecycle");
    return {
      state,
      accepted: transition.accepted,
    };
  }

  async callInstanceTool(
    roomId: string,
    instanceId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    this.logger.info("callInstanceTool.enter", {
      roomId,
      instanceId,
      toolName: name,
      inputKeys: Object.keys(input),
    });
    const room = this.requireRoom(roomId);
    const mount = this.requireMount(room, instanceId);
    ensureServerCapability(mount.session, "tools", "tools/call");
    const tool = mount.tools.find((candidate) => candidate.name === name);
    if (tool && !tool.visibility?.includes("app")) {
      throw new HttpError(
        403,
        "INVALID_COMMAND",
        `Tool is not callable by app visibility policy: ${name}`,
        {
          details: {
            tool: name,
            visibility: tool.visibility,
          },
          hint: "Only tools with _meta.ui.visibility including \"app\" can be called from app views.",
        },
      );
    }
    const session = await this.getSession(roomId, mount.server);
    const invocation = this.createInvocationForTool(
      mount.instanceId,
      mount.server,
      name,
      input,
    );
    this.insertInvocation(room, invocation);
    // GOTCHA: Tool calls can originate from background/hidden iframes; do not
    // couple invocation traffic to UI selection, or selectedInstanceId will churn.
    this.commit(room, "call");

    try {
      const result = await session.callTool(name, input);
      const currentRoom = this.requireRoom(roomId);
      const current = currentRoom.invocations.get(invocation.invocationId);
      if (current) {
        current.status = "completed";
        current.result = result;
        current.error = undefined;
        this.commit(currentRoom, "call-result");
      }
      this.logger.info("callInstanceTool.exit", {
        roomId,
        instanceId,
        toolName: name,
        status: "completed",
      });
      return result;
    } catch (error) {
      const currentRoom = this.requireRoom(roomId);
      const current = currentRoom.invocations.get(invocation.invocationId);
      if (current) {
        current.status = "failed";
        current.error = error instanceof Error ? error.message : String(error);
        this.commit(currentRoom, "call-failed");
      }
      this.logger.debug("callInstanceTool.error", {
        roomId,
        instanceId,
        toolName: name,
        error: serializeError(error),
      });
      throw error;
    }
  }

  async listInstanceTools(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "tools", "tools/list");
    const session = await this.getSession(roomId, mount.server);
    return session.listTools({ cursor });
  }

  async listInstanceResources(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "resources", "resources/list");
    const session = await this.getSession(roomId, mount.server);
    return session.listResources({ cursor });
  }

  async readInstanceResource(
    roomId: string,
    instanceId: string,
    uri: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "resources", "resources/read");
    const session = await this.getSession(roomId, mount.server);
    return session.readResource({ uri });
  }

  async listInstanceResourceTemplates(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(
      mount.session,
      "resources",
      "resources/templates/list",
    );
    const session = await this.getSession(roomId, mount.server);
    return session.listResourceTemplates({ cursor });
  }

  async listInstancePrompts(
    roomId: string,
    instanceId: string,
    cursor?: string,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "prompts", "prompts/list");
    const session = await this.getSession(roomId, mount.server);
    return session.listPrompts({ cursor });
  }

  async getInstancePrompt(
    roomId: string,
    instanceId: string,
    params: PromptGetParams,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "prompts", "prompts/get");
    const session = await this.getSession(roomId, mount.server);
    return session.getPrompt(params);
  }

  async completeInstance(
    roomId: string,
    instanceId: string,
    params: CompletionCompleteParams,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapability(mount.session, "completions", "completion/complete");
    const session = await this.getSession(roomId, mount.server);
    return session.complete(params);
  }

  async subscribeInstanceResource(
    roomId: string,
    instanceId: string,
    params: ResourceSubscriptionParams,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapabilityFeature(
      mount.session,
      "resources",
      "subscribe",
      "resources/subscribe",
    );
    const session = await this.getSession(roomId, mount.server);
    return session.subscribeResource(params);
  }

  async unsubscribeInstanceResource(
    roomId: string,
    instanceId: string,
    params: ResourceSubscriptionParams,
  ): Promise<unknown> {
    const mount = this.getInstanceMount(roomId, instanceId);
    ensureServerCapabilityFeature(
      mount.session,
      "resources",
      "subscribe",
      "resources/unsubscribe",
    );
    const session = await this.getSession(roomId, mount.server);
    return session.unsubscribeResource(params);
  }

  private async inspectServerWithSession(
    roomId: string,
    serverUrl: string,
  ): Promise<ServerInspection> {
    this.logger.info("inspectServerWithSession.enter", { roomId, serverUrl });
    this.assertServerAllowed(serverUrl);
    const session = await this.getSession(roomId, serverUrl);
    const tools = await this.collectToolCatalog(session);
    const resources = await this.collectResourcesBestEffort(session);

    const uiCandidateSet = new Set<string>();
    for (const tool of tools) {
      if (tool.uiResourceUri) {
        uiCandidateSet.add(tool.uiResourceUri);
      }
    }
    for (const resource of resources) {
      if (isUiCandidateResource(resource)) {
        uiCandidateSet.add(resource.uri);
      }
    }

    const uiCandidates = [...uiCandidateSet].sort((left, right) =>
      left.localeCompare(right),
    );
    const autoMountable = uiCandidates.length === 1;
    const recommendedUiResourceUri = autoMountable ? uiCandidates[0] : undefined;

    const inspection = {
      server: serverUrl,
      tools,
      uiCandidates,
      autoMountable,
      recommendedUiResourceUri,
      exampleCommands: buildExampleCommands(serverUrl, uiCandidates),
    };
    this.logger.info("inspectServerWithSession.exit", {
      roomId,
      serverUrl,
      tools: inspection.tools.length,
      uiCandidates: inspection.uiCandidates.length,
      autoMountable: inspection.autoMountable,
    });
    return inspection;
  }

  private async collectToolCatalog(session: McpSession): Promise<RoomMountTool[]> {
    const toolsByName = new Map<string, RoomMountTool>();
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const page = parseToolsPage(
        await session.listTools(cursor ? { cursor } : undefined),
      );
      for (const tool of page.tools) {
        if (!toolsByName.has(tool.name)) {
          toolsByName.set(tool.name, tool);
        }
      }

      if (!page.nextCursor || visitedCursors.has(page.nextCursor)) {
        break;
      }

      visitedCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    return [...toolsByName.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }

  private async collectResourcesBestEffort(
    session: McpSession,
  ): Promise<Array<{ uri: string; mimeType?: string }>> {
    try {
      return await this.collectResources(session);
    } catch {
      // GOTCHA: resources/list can be unsupported or disabled; inspection should still return tool-derived data.
      return [];
    }
  }

  private async collectResources(
    session: McpSession,
  ): Promise<Array<{ uri: string; mimeType?: string }>> {
    const resourcesByUri = new Map<string, { uri: string; mimeType?: string }>();
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const page = parseResourcesPage(
        await session.listResources(cursor ? { cursor } : undefined),
      );
      for (const resource of page.resources) {
        if (!resourcesByUri.has(resource.uri)) {
          resourcesByUri.set(resource.uri, resource);
        }
      }

      if (!page.nextCursor || visitedCursors.has(page.nextCursor)) {
        break;
      }

      visitedCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }

    return [...resourcesByUri.values()].sort((left, right) =>
      left.uri.localeCompare(right.uri),
    );
  }

  private selectMountUiResourceUri(
    command: Extract<RoomCommand, { type: "mount" }>,
    inspection: ServerInspection,
  ): string | undefined {
    if (command.uiResourceUri) {
      if (
        inspection.uiCandidates.length > 0 &&
        !inspection.uiCandidates.includes(command.uiResourceUri)
      ) {
        throw new HttpError(
          422,
          "UI_RESOURCE_INVALID",
          `UI resource URI is not available from server ${command.server}: ${command.uiResourceUri}`,
          {
            details: {
              uiCandidates: inspection.uiCandidates,
              exampleCommands: inspection.exampleCommands,
            },
          },
        );
      }
      return command.uiResourceUri;
    }

    if (inspection.uiCandidates.length === 1) {
      return inspection.uiCandidates[0];
    }
    return undefined;
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
      case "select":
        return this.handleSelect(room, command.instanceId);
      case "reorder":
        return this.handleReorder(room, command.order);
      case "layout":
        return this.handleLayout(room, command.adapter, command.ops);
      default:
        throw new HttpError(
          400,
          "INVALID_COMMAND",
          `Unsupported command type: ${String(command)}`,
        );
    }
  }

  private async handleMount(
    room: RoomRuntime,
    command: Extract<RoomCommand, { type: "mount" }>,
  ): Promise<CommandExecutionResult> {
    this.logger.info("handleMount.enter", {
      roomId: room.roomId,
      instanceId: command.instanceId,
      server: command.server,
    });
    if (room.mounts.has(command.instanceId)) {
      throw new HttpError(
        409,
        "INSTANCE_EXISTS",
        `Instance already mounted: ${command.instanceId}`,
      );
    }

    const normalizedServer = normalizeServerTarget(command.server);
    const hadSessionForServer = room.sessions.has(normalizedServer);
    if (!hadSessionForServer) {
      this.clientCapabilityRegistry.configureForMount(
        room.roomId,
        normalizedServer,
        command.clientCapabilities,
      );
    }

    let inspection: ServerInspection;
    let session: McpSession;
    try {
      inspection = await this.inspectServerWithSession(
        room.roomId,
        normalizedServer,
      );
      session = await this.getSession(room.roomId, normalizedServer);
      const selectedUiResourceUri = this.selectMountUiResourceUri(
        command,
        inspection,
      );
      if (hadSessionForServer) {
        this.clientCapabilityRegistry.configureForMount(
          room.roomId,
          normalizedServer,
          command.clientCapabilities,
        );
      }

      const negotiated = cloneNegotiatedSession(session.getNegotiatedSession());
      room.sessions.set(normalizedServer, cloneNegotiatedSession(negotiated));

      const mount: RoomMount = {
        instanceId: command.instanceId,
        mountNonce: createMountNonce(command.instanceId, this.mountNonceCounter++),
        server: normalizedServer,
        uiResourceUri: selectedUiResourceUri,
        session: negotiated,
        visible: true,
        container: { ...command.container },
        tools: inspection.tools.map((tool) => cloneMountTool(tool)),
      };

      room.mounts.set(mount.instanceId, mount);
      room.order.push(mount.instanceId);
      room.selectedInstanceId = mount.instanceId;
      room.lifecycleByInstance.delete(mount.instanceId);
      room.lifecycleSessionIdsByInstance.delete(mount.instanceId);
      const state = this.commit(room, "mount");
      const response = this.successWithState(state);
      this.logger.info("handleMount.exit", {
        roomId: room.roomId,
        instanceId: command.instanceId,
        revision: state.revision,
      });
      return response;
    } catch (error) {
      if (!hadSessionForServer) {
        room.sessions.delete(normalizedServer);
        this.clientCapabilityRegistry.clear(room.roomId, normalizedServer);
        await this.sessionFactory.releaseSession(room.roomId, normalizedServer);
      }
      this.logger.debug("handleMount.error", {
        roomId: room.roomId,
        instanceId: command.instanceId,
        server: normalizedServer,
        error: serializeError(error),
      });
      throw error;
    }
  }

  private handleVisibility(
    room: RoomRuntime,
    instanceId: string,
    visible: boolean,
    reason: "hide" | "show",
  ): CommandExecutionResult {
    const mount = this.requireMount(room, instanceId);

    if (mount.visible === visible) {
      return this.successFromRoom(room);
    }

    mount.visible = visible;
    const state = this.commit(room, reason);
    return this.successWithState(state);
  }

  private async handleUnmount(
    room: RoomRuntime,
    instanceId: string,
  ): Promise<CommandExecutionResult> {
    this.logger.info("handleUnmount.enter", { roomId: room.roomId, instanceId });
    const mount = this.requireMount(room, instanceId);
    const mountedServer = mount.server;

    room.mounts.delete(instanceId);
    room.lifecycleByInstance.delete(instanceId);
    room.lifecycleSessionIdsByInstance.delete(instanceId);
    room.order = room.order.filter((id) => id !== instanceId);

    const hasRemainingForServer = [...room.mounts.values()].some(
      (remaining) => remaining.server === mountedServer,
    );
    if (!hasRemainingForServer) {
      room.sessions.delete(mountedServer);
      this.clientCapabilityRegistry.clear(room.roomId, mountedServer);
      await this.sessionFactory.releaseSession(room.roomId, mountedServer);
    }

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
    const response = this.successWithState(state);
    this.logger.info("handleUnmount.exit", {
      roomId: room.roomId,
      instanceId,
      revision: state.revision,
    });
    return response;
  }

  private handleSelect(
    room: RoomRuntime,
    instanceId: string | null,
  ): CommandExecutionResult {
    if (instanceId !== null && !room.mounts.has(instanceId)) {
      throw new HttpError(
        404,
        "INSTANCE_NOT_FOUND",
        `Unknown instance: ${instanceId}`,
      );
    }

    if (room.selectedInstanceId === instanceId) {
      return this.successFromRoom(room);
    }

    room.selectedInstanceId = instanceId;
    const state = this.commit(room, "select");
    return this.successWithState(state);
  }

  private handleReorder(
    room: RoomRuntime,
    order: string[],
  ): CommandExecutionResult {
    if (new Set(order).size !== order.length) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        "Reorder command contains duplicate instance ids",
      );
    }

    const currentIds = new Set(room.mounts.keys());
    if (order.length !== currentIds.size) {
      throw new HttpError(
        400,
        "INVALID_COMMAND",
        "Reorder command must include every mounted instance",
      );
    }

    for (const instanceId of order) {
      if (!currentIds.has(instanceId)) {
        throw new HttpError(
          400,
          "INVALID_COMMAND",
          `Unknown instance in reorder: ${instanceId}`,
        );
      }
    }

    if (
      order.length === room.order.length &&
      order.every((id, idx) => id === room.order[idx])
    ) {
      return this.successFromRoom(room);
    }

    room.order = [...order];
    const state = this.commit(room, "reorder");
    return this.successWithState(state);
  }

  private handleLayout(
    room: RoomRuntime,
    adapterName: LayoutAdapterName | undefined,
    ops: LayoutOp[],
  ): CommandExecutionResult {
    const containers = new Map<string, GridContainer>();
    for (const [instanceId, mount] of room.mounts.entries()) {
      containers.set(instanceId, mount.container);
    }

    const result = computeLayoutUpdate({
      adapterName,
      ops,
      order: room.order,
      containers,
    });

    if (!result.changed) {
      return this.successFromRoom(room);
    }

    for (const [instanceId, container] of result.nextContainers.entries()) {
      const mount = this.requireMount(room, instanceId);
      mount.container = { ...container };
    }
    room.order = [...result.nextOrder];

    const state = this.commit(room, "layout");
    return this.successWithState(state);
  }

  private successFromRoom(room: RoomRuntime): CommandExecutionResult {
    return this.successWithState(this.buildState(room));
  }

  private successWithState(state: RoomState): CommandExecutionResult {
    return {
      statusCode: 200,
      response: {
        ok: true,
        revision: state.revision,
        state,
      },
    };
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

  private createInvocationForTool(
    instanceId: string,
    server: string,
    toolName: string,
    input: Record<string, unknown>,
  ): RoomInvocation {
    const invocationId = `inv-${Date.now()}-${this.invocationCounter++}`;
    return {
      invocationId,
      instanceId,
      server,
      toolName,
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
      .map((mount) => ({
        ...mount,
        session: cloneNegotiatedSession(mount.session),
        container: { ...mount.container },
        tools: mount.tools.map((tool) => cloneMountTool(tool)),
      }));

    const invocations = room.invocationOrder
      .map((id) => room.invocations.get(id))
      .filter((invocation): invocation is RoomInvocation => !!invocation)
      .map((invocation) => ({ ...invocation, input: { ...invocation.input } }));

    const lifecycle = buildLifecycle(mounts, room.lifecycleByInstance);

    return {
      roomId: room.roomId,
      revision: room.revision,
      mounts,
      order: [...room.order],
      selectedInstanceId: room.selectedInstanceId,
      invocations,
      lifecycle,
      assurance: buildAssuranceFromLifecycle(mounts, lifecycle),
    };
  }

  private getInstanceMount(roomId: string, instanceId: string): RoomMount {
    const room = this.requireRoom(roomId);
    return this.requireMount(room, instanceId);
  }

  private requireRoom(roomId: string): RoomRuntime {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new HttpError(404, "ROOM_NOT_FOUND", `Room not found: ${roomId}`);
    }
    return room;
  }

  private requireMount(room: RoomRuntime, instanceId: string): RoomMount {
    const mount = room.mounts.get(instanceId);
    if (!mount) {
      throw new HttpError(
        404,
        "INSTANCE_NOT_FOUND",
        `Instance not found: ${instanceId}`,
      );
    }
    return mount;
  }

  private async getSession(roomId: string, serverUrl: string): Promise<McpSession> {
    return this.sessionFactory.getSession(roomId, serverUrl);
  }

  private assertServerAllowed(serverUrl: string): void {
    assertServerAllowedByPolicy(serverUrl, {
      serverAllowlist: this.serverAllowlist,
      stdioCommandAllowlist: this.stdioCommandAllowlist,
      allowRemoteHttpServers: this.allowRemoteHttpServers,
      remoteHttpOriginAllowlist: this.remoteHttpOriginAllowlist,
    });
  }
}
