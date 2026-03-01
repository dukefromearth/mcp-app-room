# Example: Basic Host

A room-first MCP host that renders multiple tool UIs on a shared canvas through `roomd`, while keeping secure sandbox boundaries.

## Key Files

- [`index.html`](index.html) / [`src/index.tsx`](src/index.tsx) - Room-first host UI entrypoint
- [`sandbox.html`](sandbox.html) / [`src/sandbox.ts`](src/sandbox.ts) - Outer iframe proxy with security validation and bidirectional message relay
- [`src/room-canvas.tsx`](src/room-canvas.tsx) - Shared-session canvas manager
- [`src/implementation.ts`](src/implementation.ts) - Sandbox loading and AppBridge setup

## Getting Started

```bash
npm install
npm run start
# Open the host based on what the port is configured to.
```

By default, the host application will try to connect to an MCP server at `http://localhost:3001/mcp`. You can configure this behavior by setting the `SERVERS` environment variable with a JSON array of server URLs:

```bash
SERVERS='["http://localhost:1234/mcp", "http://localhost:5678/mcp"]' npm run start
```

## Shared Session Canvas Mode

`basic-host` now supports a room-driven canvas mode (multi-instance mount lifecycle via `roomd`).

Start `roomd` in another terminal:

```bash
npm run --workspace services/roomd start
```

Open room mode:

```text
http://localhost:{{host.ports.host}}/?mode=room&roomd={{roomd.baseUrl}}&room={{host.roomId}}
```

Optional config bootstrap:

- Set `host.roomConfigId` (and optional `host.roomConfigNamespace`) in `config/global.yaml`.
- On first room connect, host auto-loads that configuration only when the room has no mounts.

## Dev Sidebar

Room mode includes a protocol-fidelity dev sidebar for mounted instances:

- It runs against roomd mounted-instance endpoints (`tools/*`, `resources/*`, `prompts/*`, `completion/*`).
- It supports both schema-driven form input and raw JSON input.
- It records execution history and renders normalized results.

Query flags:

- disable sidebar: `?devSidebar=off`
- explicit enable (default is enabled): `?devSidebar=on`

## Browser Launch Defaults

When you run `basic-host`, it now auto-launches Chrome/Chromium with remote debugging enabled by default:

- Remote debugging port: `9222` (override with `BROWSER_REMOTE_DEBUGGING_PORT`)
- Auto-launch can be disabled with: `AUTO_LAUNCH_BROWSER=false`
- You can set an explicit browser binary with: `CHROME_PATH=/path/to/chrome`

## Playwright Attached Mode

The default Playwright entrypoint now attaches to the existing remote-debugging browser session:

```bash
cd /Users/duke/Documents/github/mcp-app-room
npm run playwright
```

It connects to `http://127.0.0.1:9222` by default (override with `PLAYWRIGHT_CDP_ENDPOINT`).

## Architecture

This example uses a double-iframe sandbox pattern for secure UI isolation:

```
Host (port ####)
  └── Outer iframe (port ####) - sandbox proxy
        └── Inner iframe (srcdoc) - untrusted tool UI
```

**Why two iframes?**

- The outer iframe runs on a separate origin (port ####) preventing direct access to the host
- The inner iframe receives HTML via `srcdoc` and is restricted by sandbox attributes
- Messages flow through the outer iframe which validates and relays them bidirectionally

This architecture ensures that even if tool UI code is malicious, it cannot access the host application's DOM, cookies, or JavaScript context.
