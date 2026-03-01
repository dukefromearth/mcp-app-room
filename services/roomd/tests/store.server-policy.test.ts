import { describe, expect, it } from "vitest";
import { assertServerAllowed } from "../src/store/server-policy";

describe("store/server-policy seam", () => {
  it("blocks remote HTTP servers by default with a stable hint", () => {
    try {
      assertServerAllowed("https://example.com/mcp", {
        serverAllowlist: [],
        stdioCommandAllowlist: [],
        allowRemoteHttpServers: false,
        remoteHttpOriginAllowlist: [],
      });
      throw new Error("Expected remote HTTP policy error");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        code: "SERVER_NOT_ALLOWLISTED",
        hint: "Set ROOMD_ALLOW_REMOTE_HTTP_SERVERS=true and configure ROOMD_REMOTE_HTTP_ORIGIN_ALLOWLIST.",
      });
    }
  });

  it("allows loopback HTTP servers without remote allowlist configuration", () => {
    expect(() =>
      assertServerAllowed("http://localhost:3001/mcp", {
        serverAllowlist: [],
        stdioCommandAllowlist: [],
        allowRemoteHttpServers: false,
        remoteHttpOriginAllowlist: [],
      }),
    ).not.toThrow();
  });

  it("blocks stdio commands outside the allowlist with a stable hint", () => {
    try {
      assertServerAllowed("stdio://spawn?command=node", {
        serverAllowlist: [],
        stdioCommandAllowlist: [],
        allowRemoteHttpServers: false,
        remoteHttpOriginAllowlist: [],
      });
      throw new Error("Expected stdio policy error");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 403,
        code: "SERVER_NOT_ALLOWLISTED",
        hint: "Set ROOMD_STDIO_COMMAND_ALLOWLIST to allowed commands (comma-separated, or *).",
      });
    }
  });
});
