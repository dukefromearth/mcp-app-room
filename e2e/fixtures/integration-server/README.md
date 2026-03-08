# Integration Fixture Server

Real MCP server fixture used by repository integration tests.

## Why this exists

- Tests must run against a real MCP server process, not a mocked HTTP handler.
- The fixture is self-contained in this repo so tests do not depend on external checkouts.
- It follows the upstream ext-apps integration-server pattern (tool + UI resource + Streamable HTTP transport).

## Files

- `main.mjs`: starts Streamable HTTP (`/mcp`) or stdio transport.
- `server.mjs`: registers `get-time` tool and linked UI resource.
- `mcp-app.html`: checked-in fallback UI payload served as `text/html;profile=mcp-app`.
- `dist/mcp-app.html`: optional preferred build artifact when present.

## Run

```bash
npm run fixture:integration-server
```

## Upstream alignment

This fixture is copied and adapted from:

- `https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/integration-server`

Adaptations are intentionally minimal:

- JS runtime entrypoints (`.mjs`) so tests can launch with plain `node`.
- Deterministic fixture UI payload with checked-in fallback (`mcp-app.html`).
