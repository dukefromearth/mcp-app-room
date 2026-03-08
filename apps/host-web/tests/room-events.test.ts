import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomState } from "../src/room-canvas/contracts";
import { subscribeToRoomEvents } from "../src/room-canvas/room-events";
import { RoomdRequestError } from "../src/room-canvas/roomd-client";
import type { RoomdClient } from "../src/room-canvas/roomd-client";

class FakeEventSource {
  closed = false;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;

  constructor(_url: string) {}

  addEventListener(_type: string, _listener: (event: MessageEvent) => void): void {}

  close(): void {
    this.closed = true;
  }
}

function createRoomState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: "demo",
    revision: 1,
    mounts: [],
    order: [],
    selectedInstanceId: null,
    invocations: [],
    lifecycle: {
      instances: [],
    },
    assurance: {
      generatedAt: new Date(0).toISOString(),
      instances: [],
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("subscribeToRoomEvents", () => {
  it("continues subscription when autoload races with another client", async () => {
    const sources: FakeEventSource[] = [];
    const EventSourceStub = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        sources.push(this);
      }
    };
    vi.stubGlobal("EventSource", EventSourceStub as unknown as typeof EventSource);

    const emptyState = createRoomState({ mounts: [] });
    const loadedState = createRoomState({
      revision: 2,
      mounts: [
        {
          instanceId: "ledger",
          mountNonce: "mnt-ledger",
          server: "http://localhost:3001/mcp",
          visible: true,
          container: { x: 0, y: 0, w: 6, h: 4 },
          tools: [],
        },
      ],
      order: ["ledger"],
      selectedInstanceId: "ledger",
    });

    let fetchCount = 0;
    const client = {
      ensureRoom: vi.fn(async () => {}),
      fetchRoomState: vi.fn(async () => {
        fetchCount += 1;
        return fetchCount === 1 ? emptyState : loadedState;
      }),
      loadRoomConfig: vi.fn(async () => {
        throw new RoomdRequestError(409, "Room must be empty", "ROOM_NOT_EMPTY");
      }),
      getEventsUrl: vi.fn(() => "http://localhost:8090/rooms/demo/events?sinceRevision=2"),
    } as unknown as RoomdClient;

    const handlers = {
      onSnapshot: vi.fn(),
      onEvent: vi.fn(),
      onError: vi.fn(),
      onReconnect: vi.fn(),
    };

    const cleanup = await subscribeToRoomEvents(
      client,
      "demo",
      { roomConfigId: "banking-room", roomConfigNamespace: "default" },
      handlers,
    );

    expect(client.loadRoomConfig).toHaveBeenCalledTimes(1);
    expect(client.fetchRoomState).toHaveBeenCalledTimes(2);
    expect(handlers.onSnapshot).toHaveBeenCalledWith(loadedState);
    expect(handlers.onError).not.toHaveBeenCalled();

    cleanup();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.closed).toBe(true);
  });

  it("rethrows autoload failures that are not ROOM_NOT_EMPTY races", async () => {
    const EventSourceStub = class extends FakeEventSource {};
    vi.stubGlobal("EventSource", EventSourceStub as unknown as typeof EventSource);

    const client = {
      ensureRoom: vi.fn(async () => {}),
      fetchRoomState: vi.fn(async () => createRoomState()),
      loadRoomConfig: vi.fn(async () => {
        throw new RoomdRequestError(404, "Unknown room configuration", "CONFIG_NOT_FOUND");
      }),
      getEventsUrl: vi.fn(() => "http://localhost:8090/rooms/demo/events?sinceRevision=1"),
    } as unknown as RoomdClient;

    await expect(
      subscribeToRoomEvents(
        client,
        "demo",
        { roomConfigId: "missing-config" },
        {
          onSnapshot: vi.fn(),
          onEvent: vi.fn(),
          onError: vi.fn(),
          onReconnect: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({
      code: "CONFIG_NOT_FOUND",
    });

    expect(client.fetchRoomState).toHaveBeenCalledTimes(1);
  });
});
