import type { RoomEvent, RoomState } from "./contracts";
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
  handlers: RoomSubscriptionHandlers,
): Promise<() => void> {
  await client.ensureRoom(roomId);
  const snapshot = await client.fetchRoomState(roomId);
  handlers.onSnapshot(snapshot);

  const source = new EventSource(client.getEventsUrl(roomId, snapshot.revision));
  const onStateEvent = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data) as RoomEvent;
      handlers.onEvent(parsed.state);
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : String(error));
    }
  };

  source.addEventListener("state-updated", onStateEvent);
  source.addEventListener("snapshot-reset", onStateEvent);
  source.onerror = () => {
    handlers.onReconnect();
  };

  return () => {
    source.close();
  };
}
