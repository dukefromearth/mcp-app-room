#!/usr/bin/env node

import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

const port = Number.parseInt(process.env.PORT ?? "3137", 10);
const resourceUri = "ui://integration-test/mcp-app.html";

const appHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Integration Fixture</title>
  </head>
  <body>
    <main>
      <h1>Integration Fixture</h1>
      <p>This fixture intentionally does not initialize an MCP App bridge.</p>
    </main>
  </body>
</html>`;

function createServer() {
  const server = new McpServer({
    name: "Integration Fixture Server",
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
      _meta: {
        ui: {
          resourceUri,
        },
      },
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
    resourceUri,
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: appHtml,
        },
      ],
    }),
  );

  return server;
}

const app = createMcpExpressApp({ host: "127.0.0.1" });
app.use(cors());

app.all("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[integration-fixture] MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const httpServer = app.listen(port, "127.0.0.1", () => {
  console.log(`[integration-fixture] MCP server listening on http://127.0.0.1:${port}/mcp`);
});

const shutdown = () => {
  httpServer.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
