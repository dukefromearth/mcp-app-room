import { describe, expect, it } from "vitest";
import { buildNegotiatedSession } from "../src/mcp-session-metadata";

describe("MCP session metadata", () => {
  it("captures negotiated extensions from capabilities.extensions", () => {
    const negotiated = buildNegotiatedSession(
      {
        getServerCapabilities: () => ({
          tools: {},
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        }),
      },
      "streamable-http",
      "2025-11-25",
    );

    expect(negotiated.extensions).toMatchObject({
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    });
  });

  it("keeps experimental extension values for backwards compatibility", () => {
    const negotiated = buildNegotiatedSession(
      {
        getServerCapabilities: () => ({
          tools: {},
          experimental: {
            legacyFeature: true,
          },
        }),
      },
      "legacy-sse",
      "2025-11-25",
    );

    expect(negotiated.extensions).toMatchObject({
      legacyFeature: true,
    });
  });
});
