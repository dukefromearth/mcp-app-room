import { describe, expect, it } from "vitest";
import { commandEnvelope, newStore } from "./store.fixtures";

describe("RoomStore lifecycle behavior locks", () => {
  it("does not increment revision when layout command is a no-op", async () => {
    const store = newStore();
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const before = store.getState("demo");
    const response = await store.applyCommand(
      "demo",
      commandEnvelope("cmd-layout-no-op", {
        type: "layout",
        ops: [
          {
            op: "set",
            instanceId: "inst-1",
            container: { x: 0, y: 0, w: 6, h: 4 },
          },
        ],
      }),
    );
    const after = store.getState("demo");

    expect(response.statusCode).toBe(200);
    expect(response.response.revision).toBe(before.revision);
    expect(after.revision).toBe(before.revision);
  });

  it("releases session only after the last mounted instance is unmounted", async () => {
    const releases: Array<{ roomId: string; serverUrl: string }> = [];
    const store = newStore({
      onReleaseSession: (roomId, serverUrl) => {
        releases.push({ roomId, serverUrl });
      },
    });
    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount-1", {
        type: "mount",
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );
    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount-2", {
        type: "mount",
        instanceId: "inst-2",
        server: "http://localhost:3001/mcp",
        container: { x: 6, y: 0, w: 6, h: 4 },
      }),
    );

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount-1", {
        type: "unmount",
        instanceId: "inst-1",
      }),
    );
    expect(releases).toEqual([]);

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount-2", {
        type: "unmount",
        instanceId: "inst-2",
      }),
    );
    expect(releases).toEqual([
      {
        roomId: "demo",
        serverUrl: "http://localhost:3001/mcp",
      },
    ]);
  });
});
