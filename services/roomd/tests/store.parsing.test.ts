import { describe, expect, it } from "vitest";
import {
  assertFileRootUris,
  parseResourcesPage,
  parseToolsPage,
} from "../src/store/parsing";

describe("store/parsing seam", () => {
  it("normalizes tool payloads and applies defaults", () => {
    const parsed = parseToolsPage({
      tools: [
        null,
        { name: " " },
        {
          name: "debug-tool",
          _meta: {
            ui: {
              resourceUri: "ui://debug-tool/mcp-app.html",
              visibility: ["app"],
            },
          },
        },
      ],
      nextCursor: "cursor-2",
    });

    expect(parsed.nextCursor).toBe("cursor-2");
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0]).toMatchObject({
      name: "debug-tool",
      uiResourceUri: "ui://debug-tool/mcp-app.html",
      visibility: ["app"],
      inputSchema: {
        type: "object",
        properties: {},
      },
    });
  });

  it("drops malformed UI metadata instead of throwing", () => {
    const parsed = parseToolsPage({
      tools: [
        {
          name: "debug-tool",
          _meta: {
            ui: {
              resourceUri: "https://invalid.example/app.html",
            },
          },
        },
      ],
    });

    expect(parsed.tools[0]).toMatchObject({
      name: "debug-tool",
    });
    expect(parsed.tools[0]?.uiResourceUri).toBeUndefined();
  });

  it("filters invalid resources entries", () => {
    const parsed = parseResourcesPage({
      resources: [{}, { uri: "ui://debug-tool/mcp-app.html", mimeType: "text/html" }],
    });

    expect(parsed.resources).toEqual([
      {
        uri: "ui://debug-tool/mcp-app.html",
        mimeType: "text/html",
      },
    ]);
  });

  it("enforces file:// roots only", () => {
    try {
      assertFileRootUris([{ uri: "https://example.com/root" }]);
      throw new Error("Expected INVALID_PAYLOAD for non-file root");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        code: "INVALID_PAYLOAD",
      });
    }
  });
});
