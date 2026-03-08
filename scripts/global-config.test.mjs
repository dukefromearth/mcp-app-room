import test from "node:test";
import assert from "node:assert/strict";
import { resolveBootstrapRooms } from "./global-config.mjs";

test("resolveBootstrapRooms adds the configured host room in room mode", () => {
  const roomIds = resolveBootstrapRooms(
    {
      host: {
        mode: "room",
        roomId: "demo",
      },
    },
    undefined,
  );

  assert.deepEqual(roomIds, ["demo"]);
});

test("resolveBootstrapRooms preserves explicit env rooms and de-duplicates the host room", () => {
  const roomIds = resolveBootstrapRooms(
    {
      host: {
        mode: "room",
        roomId: "demo",
      },
    },
    "alpha, demo, beta",
  );

  assert.deepEqual(roomIds, ["alpha", "demo", "beta"]);
});

test("resolveBootstrapRooms skips host bootstrap when not in room mode", () => {
  const roomIds = resolveBootstrapRooms(
    {
      host: {
        mode: "single-app",
        roomId: "demo",
      },
    },
    "alpha",
  );

  assert.deepEqual(roomIds, ["alpha"]);
});
