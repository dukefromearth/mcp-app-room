#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import { createServer } from "./server.mjs";

export async function startStreamableHTTPServer(createMcpServer) {
  const port = Number.parseInt(process.env.PORT ?? "3137", 10);
  const app = createMcpExpressApp({ host: "127.0.0.1" });
  app.use(cors());

  app.all("/mcp", async (req, res) => {
    const server = createMcpServer();
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
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(createMcpServer) {
  await createMcpServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
    return;
  }
  await startStreamableHTTPServer(createServer);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
