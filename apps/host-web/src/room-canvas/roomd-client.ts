import type { RoomState, UiResource } from "./contracts";

interface RoomdError {
  error?: string;
  code?: string;
}

export class RoomdRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RoomdRequestError";
  }
}

export interface RoomdClient {
  ensureRoom(roomId: string): Promise<void>;
  fetchRoomState(roomId: string): Promise<RoomState>;
  loadRoomConfig(
    configId: string,
    params: {
      roomId: string;
      namespace?: string;
      mode?: "empty_only";
      dryRun?: boolean;
      idempotencyKey: string;
    },
  ): Promise<unknown>;
  fetchUiResource(roomId: string, instanceId: string): Promise<UiResource>;
  fetchCapabilities(roomId: string, instanceId: string): Promise<Record<string, unknown> | null>;
  reportInstanceEvidence(
    roomId: string,
    instanceId: string,
    event: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error",
    details?: Record<string, unknown>,
    invocationId?: string,
  ): Promise<void>;
  postInstanceJson(roomId: string, instanceId: string, pathSuffix: string, body: unknown): Promise<unknown>;
  getEventsUrl(roomId: string, sinceRevision: number): string;
}

export function createRoomdClient(roomdUrl: string): RoomdClient {
  const roomPath = (roomId: string, suffix = ""): string =>
    `/rooms/${encodeURIComponent(roomId)}${suffix}`;
  const instancePath = (roomId: string, instanceId: string, suffix: string): string =>
    roomPath(roomId, `/instances/${encodeURIComponent(instanceId)}${suffix}`);
  const postJson = (path: string, body: unknown) =>
    fetch(new URL(path, roomdUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const parseJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>;

  return {
    async ensureRoom(roomId: string): Promise<void> {
      const response = await postJson("/rooms", { roomId });
      if (response.status !== 201 && response.status !== 409) {
        await throwRoomdResponseError(response);
      }
    },
    async fetchRoomState(roomId: string): Promise<RoomState> {
      const response = await fetch(new URL(roomPath(roomId, "/state"), roomdUrl));
      if (!response.ok) {
        await throwRoomdResponseError(response);
      }
      return (await parseJson<{ state: RoomState }>(response)).state;
    },
    async loadRoomConfig(
      configId: string,
      params: {
        roomId: string;
        namespace?: string;
        mode?: "empty_only";
        dryRun?: boolean;
        idempotencyKey: string;
      },
    ): Promise<unknown> {
      const response = await postJson(
        `/room-configs/${encodeURIComponent(configId)}/load`,
        {
          namespace: params.namespace ?? "default",
          roomId: params.roomId,
          mode: params.mode ?? "empty_only",
          dryRun: params.dryRun ?? false,
          idempotencyKey: params.idempotencyKey,
        },
      );
      if (!response.ok) {
        await throwRoomdResponseError(response);
      }
      return parseJson<unknown>(response);
    },
    async fetchUiResource(roomId: string, instanceId: string): Promise<UiResource> {
      const response = await fetch(new URL(instancePath(roomId, instanceId, "/ui"), roomdUrl));
      if (!response.ok) {
        await throwRoomdResponseError(response);
      }
      return (await parseJson<{ resource: UiResource }>(response)).resource;
    },
    async fetchCapabilities(roomId: string, instanceId: string): Promise<Record<string, unknown> | null> {
      const response = await fetch(
        new URL(instancePath(roomId, instanceId, "/capabilities"), roomdUrl),
      );
      if (!response.ok) {
        return null;
      }
      return (await parseJson<{ capabilities: Record<string, unknown> }>(response)).capabilities;
    },
    async reportInstanceEvidence(
      roomId: string,
      instanceId: string,
      event: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error",
      details?: Record<string, unknown>,
      invocationId?: string,
    ): Promise<void> {
      const payload: {
        source: "host";
        event: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error";
        details?: Record<string, unknown>;
        invocationId?: string;
      } = {
        source: "host",
        event,
      };
      if (details) {
        payload.details = details;
      }
      if (invocationId) {
        payload.invocationId = invocationId;
      }
      const response = await postJson(instancePath(roomId, instanceId, "/evidence"), payload);
      if (!response.ok) {
        await throwRoomdResponseError(response);
      }
    },
    async postInstanceJson(roomId: string, instanceId: string, pathSuffix: string, body: unknown): Promise<unknown> {
      const response = await postJson(instancePath(roomId, instanceId, `/${pathSuffix}`), body);
      if (!response.ok) {
        await throwRoomdResponseError(response);
      }
      return parseJson<unknown>(response);
    },
    getEventsUrl(roomId: string, sinceRevision: number): string {
      const eventsUrl = new URL(roomPath(roomId, "/events"), roomdUrl);
      eventsUrl.searchParams.set("sinceRevision", String(sinceRevision));
      return eventsUrl.toString();
    },
  };
}

async function throwRoomdResponseError(response: Response): Promise<never> {
  const parsed = await readErrorPayload(response);
  throw new RoomdRequestError(response.status, parsed.message, parsed.code);
}

async function readErrorPayload(
  response: Response,
): Promise<{ message: string; code?: string }> {
  const fallback = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as RoomdError;
    if (typeof body?.error === "string" && body.error.trim().length > 0) {
      return {
        message: body.error,
        ...(typeof body.code === "string" && body.code.length > 0
          ? { code: body.code }
          : {}),
      };
    }
  } catch {
    // GOTCHA: roomd may return non-JSON responses on proxy/server failures.
  }
  return { message: fallback };
}
