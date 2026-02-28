import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const exitMarkerPath = process.env.ROOMD_STDIO_EXIT_MARKER;

function writeExitMarker() {
  if (!exitMarkerPath) {
    return;
  }

  try {
    fs.writeFileSync(exitMarkerPath, String(process.pid), "utf8");
  } catch {
    // ignore marker write failures in test fixture.
  }
}

process.on("exit", () => {
  writeExitMarker();
});

const server = new McpServer(
  {
    name: "roomd-stdio-fixture",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
      completions: {},
    },
  },
);

server.registerTool(
  "fixture-tool",
  {
    description: "Fixture tool used by roomd stdio transport tests",
    inputSchema: {
      message: z.string().optional(),
    },
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: message ?? "fixture-ok",
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
