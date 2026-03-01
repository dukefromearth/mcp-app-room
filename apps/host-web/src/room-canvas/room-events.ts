import type { RoomEvent, RoomState } from "./contracts";
import { RoomdRequestError } from "./roomd-client";
import type { RoomdClient } from "./roomd-client";

interface RoomSubscriptionHandlers {
  onSnapshot(state: RoomState): void;
  onEvent(state: RoomState): void;
  onError(message: string): void;
  onReconnect(): void;
}

export async function subscribeToRoomEvents(
  client: RoomdClient,
  roomId: string,
  options: {
    roomConfigId?: string;
    roomConfigNamespace?: string;
  },
  handlers: RoomSubscriptionHandlers,
): Promise<() => void> {
  await client.ensureRoom(roomId);
  let snapshot = await client.fetchRoomState(roomId);
  if (options.roomConfigId && snapshot.mounts.length === 0) {
    try {
      await client.loadRoomConfig(options.roomConfigId, {
        roomId,
        namespace: options.roomConfigNamespace ?? "default",
        mode: "empty_only",
        dryRun: false,
        idempotencyKey: `host-autoload:${roomId}:${options.roomConfigId}:${Date.now()}`,
      });
    } catch (error) {
      if (!(error instanceof RoomdRequestError) || error.code !== "ROOM_NOT_EMPTY") {
        throw error;
      }
    }
    snapshot = await client.fetchRoomState(roomId);
  }
  handlers.onSnapshot(snapshot);

  const source = new EventSource(client.getEventsUrl(roomId, snapshot.revision));
  const onStateEvent = (event: MessageEvent) => {
    try {
      handlers.onEvent((JSON.parse(event.data) as RoomEvent).state);
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : String(error));
    }
  };

  source.addEventListener("state-updated", onStateEvent);
  source.addEventListener("snapshot-reset", onStateEvent);
  source.onerror = () => handlers.onReconnect();

  return () => source.close();
}
