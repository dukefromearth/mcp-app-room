import type { RoomState, UiResource } from "./contracts";

interface RoomdError {
  error?: string;
}

export interface RoomdClient {
  ensureRoom(roomId: string): Promise<void>;
  fetchRoomState(roomId: string): Promise<RoomState>;
  fetchUiResource(roomId: string, instanceId: string): Promise<UiResource>;
  fetchCapabilities(roomId: string, instanceId: string): Promise<Record<string, unknown> | null>;
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
        throw new Error(await readErrorMessage(response));
      }
    },
    async fetchRoomState(roomId: string): Promise<RoomState> {
      const response = await fetch(new URL(roomPath(roomId, "/state"), roomdUrl));
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      return (await parseJson<{ state: RoomState }>(response)).state;
    },
    async fetchUiResource(roomId: string, instanceId: string): Promise<UiResource> {
      const response = await fetch(new URL(instancePath(roomId, instanceId, "/ui"), roomdUrl));
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
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
    async postInstanceJson(roomId: string, instanceId: string, pathSuffix: string, body: unknown): Promise<unknown> {
      const response = await postJson(instancePath(roomId, instanceId, `/${pathSuffix}`), body);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
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

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as RoomdError;
    if (body?.error) {
      return body.error;
    }
  } catch {
    // GOTCHA: roomd may return non-JSON responses on proxy/server failures.
  }
  return `${response.status} ${response.statusText}`;
}
