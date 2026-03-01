import type { RoomState, UiResource } from "./contracts";

interface RoomdError {
  error?: string;
}

export interface RoomdClient {
  ensureRoom(roomId: string): Promise<void>;
  fetchRoomState(roomId: string): Promise<RoomState>;
  fetchUiResource(roomId: string, instanceId: string): Promise<UiResource>;
  fetchCapabilities(
    roomId: string,
    instanceId: string,
  ): Promise<Record<string, unknown> | null>;
  postInstanceJson(
    roomId: string,
    instanceId: string,
    pathSuffix: string,
    body: unknown,
  ): Promise<unknown>;
  getEventsUrl(roomId: string, sinceRevision: number): string;
}

export function createRoomdClient(roomdUrl: string): RoomdClient {
  return {
    async ensureRoom(roomId: string): Promise<void> {
      const response = await fetch(new URL("/rooms", roomdUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ roomId }),
      });

      if (response.status === 201 || response.status === 409) {
        return;
      }

      throw new Error(await readErrorMessage(response));
    },

    async fetchRoomState(roomId: string): Promise<RoomState> {
      const response = await fetch(
        new URL(`/rooms/${encodeURIComponent(roomId)}/state`, roomdUrl),
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as { state: RoomState };
      return data.state;
    },

    async fetchUiResource(roomId: string, instanceId: string): Promise<UiResource> {
      const response = await fetch(
        new URL(
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(instanceId)}/ui`,
          roomdUrl,
        ),
      );
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as { resource: UiResource };
      return data.resource;
    },

    async fetchCapabilities(
      roomId: string,
      instanceId: string,
    ): Promise<Record<string, unknown> | null> {
      const response = await fetch(
        new URL(
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(instanceId)}/capabilities`,
          roomdUrl,
        ),
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { capabilities: Record<string, unknown> };
      return data.capabilities;
    },

    async postInstanceJson(
      roomId: string,
      instanceId: string,
      pathSuffix: string,
      body: unknown,
    ): Promise<unknown> {
      const response = await fetch(
        new URL(
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(instanceId)}/${pathSuffix}`,
          roomdUrl,
        ),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      return response.json();
    },

    getEventsUrl(roomId: string, sinceRevision: number): string {
      const eventsUrl = new URL(
        `/rooms/${encodeURIComponent(roomId)}/events`,
        roomdUrl,
      );
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
