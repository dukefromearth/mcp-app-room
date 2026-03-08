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
  reportInstanceLifecycle(
    roomId: string,
    instanceId: string,
    payload: {
      mountNonce: string;
      sessionId: string;
      seq: number;
      phase: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error";
      details?: Record<string, unknown>;
    },
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
      if (response.status !== 201 && response.status !== 200) {
        await throwRoomdResponseError(response);
      }
      const parsed = await parseJson<{ created?: boolean }>(response);
      if (typeof parsed.created !== "boolean") {
        throw new RoomdRequestError(
          502,
          "UPSTREAM_TRANSPORT_ERROR",
          "roomd /rooms response missing created boolean",
        );
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
    async reportInstanceLifecycle(
      roomId: string,
      instanceId: string,
      payload: {
        mountNonce: string;
        sessionId: string;
        seq: number;
        phase: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error";
        details?: Record<string, unknown>;
      },
    ): Promise<void> {
      const requestBody: {
        mountNonce: string;
        sessionId: string;
        seq: number;
        phase: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error";
        details?: Record<string, unknown>;
      } = {
        mountNonce: payload.mountNonce,
        sessionId: payload.sessionId,
        seq: payload.seq,
        phase: payload.phase,
      };
      if (payload.details) {
        requestBody.details = payload.details;
      }
      const response = await postJson(instancePath(roomId, instanceId, "/lifecycle"), requestBody);
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
