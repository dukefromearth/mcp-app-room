import { describe, expect, it } from "vitest";
import {
  HttpError,
  invalidPayloadError,
  mapUnknownError,
} from "../src/errors";

describe("roomd error contracts", () => {
  it("serializes typed error body with stable fields", () => {
    const error = new HttpError(
      404,
      "NO_UI_RESOURCE",
      "Mounted instance inst-1 has no UI resource",
      {
        details: { instanceId: "inst-1" },
        hint: "Mount with --ui-resource-uri or use non-UI flow.",
      },
    );

    expect(error.toResponseBody()).toEqual({
      ok: false,
      error: "Mounted instance inst-1 has no UI resource",
      code: "NO_UI_RESOURCE",
      details: { instanceId: "inst-1" },
      hint: "Mount with --ui-resource-uri or use non-UI flow.",
    });
  });

  it("maps invalid payload to deterministic shape", () => {
    const error = invalidPayloadError({ issues: [{ path: ["roomId"] }] });
    expect(error.statusCode).toBe(400);
    expect(error.toResponseBody()).toMatchObject({
      ok: false,
      code: "INVALID_PAYLOAD",
      error: "Invalid payload",
      details: { issues: [{ path: ["roomId"] }] },
    });
  });

  it("maps upstream transport failures to deterministic shape", () => {
    const mapped = mapUnknownError(new Error("connect ECONNREFUSED"));
    expect(mapped.statusCode).toBe(502);
    expect(mapped.toResponseBody()).toMatchObject({
      ok: false,
      code: "UPSTREAM_TRANSPORT_ERROR",
      error: "Upstream MCP request failed",
      details: { cause: "connect ECONNREFUSED" },
    });
  });
});
