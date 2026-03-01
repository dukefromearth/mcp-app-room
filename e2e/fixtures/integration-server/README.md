# Integration Fixture Server

Real MCP server fixture used by repository integration tests.

## Why this exists

- Tests must run against a real MCP server process, not a mocked HTTP handler.
- The fixture is self-contained in this repo so tests do not depend on external checkouts.
- It follows the upstream ext-apps integration-server pattern (tool + UI resource + Streamable HTTP transport).

## Files

- `main.mjs`: starts Streamable HTTP (`/mcp`) or stdio transport.
- `server.mjs`: registers `get-time` tool and linked UI resource.
- `dist/mcp-app.html`: bundled UI payload served as `text/html;profile=mcp-app`.

## Run

```bash
npm run fixture:integration-server
```

Optional stdio mode:

```bash
npm run fixture:integration-server:stdio
```

## Upstream alignment

This fixture is copied and adapted from:

- `https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/integration-server`

Adaptations are intentionally minimal:

- JS runtime entrypoints (`.mjs`) so tests can launch with plain `node`.
- Localized static UI bundle at `dist/mcp-app.html`.
