# Example: Basic Host

A room-first MCP host that renders multiple tool UIs on a shared canvas through `roomd`, while keeping secure sandbox boundaries.

## Key Files

- [`index.html`](index.html) / [`src/index.tsx`](src/index.tsx) - Room-first host UI entrypoint
- [`sandbox.html`](sandbox.html) / [`src/sandbox.ts`](src/sandbox.ts) - Outer iframe proxy with security validation and bidirectional message relay
- [`src/room-canvas.tsx`](src/room-canvas.tsx) - Shared-session canvas manager
- [`src/implementation.ts`](src/implementation.ts) - Sandbox loading and AppBridge setup
- [`SHARED_SESSION_CANVAS_SPEC.md`](SHARED_SESSION_CANVAS_SPEC.md) - Guideline spec for shared-session canvas mounts + CLI-driven lifecycle control

## Getting Started

```bash
npm install
npm run start
# Open http://localhost:8080
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
http://localhost:8080/?mode=room&roomd=http://localhost:8090&room=demo
```

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
Host (port 8080)
  └── Outer iframe (port 8081) - sandbox proxy
        └── Inner iframe (srcdoc) - untrusted tool UI
```

**Why two iframes?**

- The outer iframe runs on a separate origin (port 8081) preventing direct access to the host
- The inner iframe receives HTML via `srcdoc` and is restricted by sandbox attributes
- Messages flow through the outer iframe which validates and relays them bidirectionally

This architecture ensures that even if tool UI code is malicious, it cannot access the host application's DOM, cookies, or JavaScript context.
