# Real MCP Integration Testing

This repository uses a canonical real MCP fixture for integration tests.

## Canonical fixture

- Fixture entrypoint: `e2e/fixtures/integration-server/main.mjs`
- Fixture server definition: `e2e/fixtures/integration-server/server.mjs`
- Fixture UI payload: `e2e/fixtures/integration-server/dist/mcp-app.html`

Run fixture directly:

```bash
npm run fixture:integration-server
```

## Canonical integration suite

Run both real-MCP integration specs:

```bash
npm run test:integration:real-mcp
```

Included specs:

- `e2e/playwright/roomctl-await-real-server.e2e.spec.ts`
  - Negative lifecycle path with real MCP server and roomd.
  - Host is intentionally not started, so `app_initialized` is expected to be missing.
- `e2e/playwright/roomctl-real-server-host-lifecycle.e2e.spec.ts`
  - Positive lifecycle path with real MCP server + roomd + host.
  - Asserts `bridge_connected` then `app_initialized`, and confirms default `tool-call` behavior.

## Why negative path can fail without host

`tool-call` success only proves RPC to the upstream MCP endpoint. UI lifecycle evidence (`bridge_connected`, `resource_delivered`, `app_initialized`) requires host-side rendering flow.

If host is not running for a test, missing `app_initialized` is expected and should be treated as an explicit unknown, not a false success.

## Troubleshooting

1. Port conflicts:
   - Ensure no stale host/roomd/fixture processes are running.
2. Fixture reachable:
   - Check `http://127.0.0.1:<port>/mcp` responds (status may be `406` without MCP payload, which is still a liveness signal).
3. Host lifecycle evidence missing in positive spec:
   - Confirm host process started from the same generated global config as roomd.
   - Confirm room mount exists and UI tile is visible before awaiting lifecycle evidence.
4. Security profile mismatches:
   - Integration specs expect `security.profile: local-dev` in generated config.
