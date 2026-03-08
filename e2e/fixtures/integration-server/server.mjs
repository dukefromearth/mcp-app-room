import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "dist");
const FALLBACK_HTML_PATH = path.join(__dirname, "mcp-app.html");
const RESOURCE_URI = "ui://get-time/mcp-app.html";

async function loadFixtureHtml() {
  const candidates = [
    path.join(DIST_DIR, "mcp-app.html"),
    FALLBACK_HTML_PATH,
  ];

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf-8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Fixture UI payload missing. Expected one of: ${candidates.join(", ")}`,
  );
}

export function createServer() {
  const server = new McpServer({
    name: "Integration Test Server",
    version: "1.0.0",
  });

  registerAppTool(
    server,
    "get-time",
    {
      title: "Get Time",
      description: "Returns the current server time.",
      inputSchema: {},
      outputSchema: z.object({
        time: z.string(),
      }),
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      const time = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ time }),
          },
        ],
        structuredContent: { time },
      };
    },
  );

  registerAppResource(
    server,
    RESOURCE_URI,
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await loadFixtureHtml();
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
