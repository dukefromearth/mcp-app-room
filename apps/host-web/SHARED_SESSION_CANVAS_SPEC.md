# Shared Session Canvas Spec (Guideline)

Status: Draft  
Scope: `apps/host-web`

## Problem

We want `basic-host` behavior (secure MCP App rendering) plus:

1. Multiple app instances mounted anywhere on one canvas (add/remove/hide/show).
2. Mount lifecycle driven from CLI.
3. Browser and CLI operating on the same effective MCP session.

## Goals

1. Preserve `basic-host` security model as the default.
2. Add a minimal control plane for mount lifecycle.
3. Keep implementation small enough for a sub-2-week delivery.

## Non-goals

1. Full multi-tenant production gateway.
2. Complex permissions/roles model.
3. Distributed deployment correctness beyond a single-node baseline.

## Core Principle

Treat each rendered app as an `AppInstance` with:

1. Secure sandbox runtime.
2. Explicit lifecycle (`mount`, `hide`, `show`, `unmount`, `destroy`).
3. External control via room commands.

Layout is host-owned. App code never controls host DOM directly.

## Proposed Architecture

## 1) Room Proxy (`roomd`)

A small Node service that owns one upstream MCP client per `roomId`.

Responsibilities:

1. Maintain one effective session per room.
2. Persist room state (`mounts`, order, visibility, selected instance).
3. Broadcast state changes via SSE.
4. Accept commands from CLI/browser and apply idempotently.

## 2) Browser Host (`basic-host` + canvas manager)

Responsibilities:

1. Render room state as container wrappers on a canvas.
2. For each mounted app/server instance, create/update an `AppInstance`.
3. Keep current sandbox boundary model (outer sandbox proxy + inner iframe).
4. React to room events; never mutate room state locally without command round-trip.

## 3) CLI

CLI talks only to `roomd` command endpoint.

Example operations:

1. `inspect` server UI/tool catalog before mount.
2. `mount` app/server instance into a target container slot.
3. `hide` / `show`.
4. `unmount`.
5. `tool-call` for explicit named tool invocation.

## API Contract (Minimal)

## Server Inspection

`POST /inspect/server`

Request:

```json
{
  "server": "http://localhost:3001/mcp"
}
```

Response includes:
- `tools[]` summaries (name/title/description/inputSchema + optional per-tool UI URI).
- `uiCandidates[]` deduped mountable UI URIs.
- `autoMountable` and optional `recommendedUiResourceUri`.
- `exampleCommands[]` with concrete `roomctl mount ...` follow-up commands.

## Command Endpoint

`POST /rooms/:roomId/commands`

Request:

```json
{
  "idempotencyKey": "cmd-123",
  "command": {
    "type": "mount",
    "instanceId": "inst-debug-1",
    "server": "http://localhost:3001/mcp",
    "uiResourceUri": "ui://debug-tool/mcp-app.html",
    "container": { "x": 0, "y": 0, "w": 6, "h": 4 }
  }
}
```

Response:

```json
{
  "ok": true,
  "revision": 12,
  "state": {}
}
```

## State Endpoint

`GET /rooms/:roomId/state` -> full room snapshot + `revision`.

## Event Stream

`GET /rooms/:roomId/events` (SSE) -> ordered updates:

```json
{
  "revision": 13,
  "type": "state-updated",
  "state": {}
}
```

## Room State Shape (Reference)

```json
{
  "roomId": "demo",
  "revision": 13,
  "mounts": [
    {
      "instanceId": "inst-debug-1",
      "server": "http://localhost:3001/mcp",
      "uiResourceUri": "ui://debug-tool/mcp-app.html",
      "visible": true,
      "container": { "x": 0, "y": 0, "w": 6, "h": 4 },
      "tools": [
        {
          "name": "debug-tool",
          "title": "Debug",
          "description": "Debug helper",
          "inputSchema": { "type": "object", "properties": {} },
          "uiResourceUri": "ui://debug-tool/mcp-app.html"
        }
      ]
    }
  ]
}
```

`mount.uiResourceUri` is optional; missing UI means the mount is tool-usable but
renders in non-UI placeholder mode.

## Security Requirements

1. Keep cross-origin outer sandbox proxy model from `basic-host`.
2. Default sandbox must NOT include `allow-same-origin`.
3. Any sandbox policy relaxation must be explicit and allowlisted.
4. Validate postMessage origin and source strictly.
5. Treat CLI input as untrusted; validate all command payloads.

## Rendering Flow

1. `mount` command stored in room state.
2. Browser receives new state (SSE).
3. Browser creates `AppInstance` for mount.
4. If `uiResourceUri` exists, `AppInstance` reads the selected UI resource.
5. Browser reads resource and sends HTML to sandbox proxy (`sendSandboxResourceReady`).
6. Without `uiResourceUri`, tile stays in non-UI mode and tool operations remain available.

## Reliability Rules

1. Monotonic `revision` per room mutation.
2. Idempotency key required for command writes.
3. Last-write-wins only for layout fields; lifecycle commands are explicit.
4. Reconnect behavior: browser requests latest state and reconciles local instances.

## Implementation Plan (Low Code)

1. Slice A (2-3 days): `roomd` with `state`, `events`, `commands` + in-memory state.
2. Slice B (2-3 days): canvas mount manager in `basic-host` UI.
3. Slice C (1-2 days): CLI helper commands for room operations.
4. Slice D (1-2 days): hardening (validation, idempotency, reconnect tests).

Target: 7-10 days, well under 10k LOC.

## Acceptance Criteria

1. CLI `mount` creates visible app instance in browser without reload.
2. CLI `hide/show` toggles visibility without losing app instance identity.
3. CLI `unmount` removes instance and destroys bridge/runtime.
4. Browser reconnect reproduces room state from `GET /state`.
5. Two clients (CLI + browser) observe identical room `revision` progression.
6. No host DOM access from app iframe under default sandbox policy.
