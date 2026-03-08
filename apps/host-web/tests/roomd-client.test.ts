import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomdClient, RoomdRequestError } from "../src/room-canvas/roomd-client";

describe("roomd client route contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts idempotent room create statuses (201 and 200)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, created: true, state: { roomId: "demo" } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, created: false, state: { roomId: "demo" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRoomdClient("http://localhost:8090");
    await client.ensureRoom("demo");
    await client.ensureRoom("demo");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails room create on non-idempotent statuses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, code: "ROOM_EXISTS", error: "duplicate" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRoomdClient("http://localhost:8090");
    await expect(client.ensureRoom("demo")).rejects.toBeInstanceOf(RoomdRequestError);
  });

  it("posts lifecycle evidence to canonical lifecycle route", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, revision: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRoomdClient("http://localhost:8090");
    await client.reportInstanceEvidence("demo", "inst-1", "app_initialized");

    const [firstCall] = fetchMock.mock.calls;
    expect(firstCall).toBeDefined();
    const url = firstCall[0];
    expect(String(url)).toContain("/rooms/demo/instances/inst-1/lifecycle");
  });
});
