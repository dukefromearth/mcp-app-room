# roomd

`roomd` is a minimal room control-plane service for shared-session canvas hosting.

## Endpoints

- `POST /inspect/server`
- `POST /rooms`
- `GET /rooms/:roomId/state`
- `GET /rooms/:roomId/events`
- `POST /rooms/:roomId/commands`

Auxiliary host endpoints:

- `GET /rooms/:roomId/instances/:instanceId/ui`
- `GET /rooms/:roomId/instances/:instanceId/capabilities`
- `GET /rooms/:roomId/instances/:instanceId/client-capabilities`
- `PUT /rooms/:roomId/instances/:instanceId/client-capabilities/roots`
- `PATCH /rooms/:roomId/instances/:instanceId/client-capabilities/sampling`
- `PATCH /rooms/:roomId/instances/:instanceId/client-capabilities/elicitation`
- `POST /rooms/:roomId/instances/:instanceId/client-capabilities/sampling/preview`
- `POST /rooms/:roomId/instances/:instanceId/client-capabilities/elicitation/preview`
- `POST /rooms/:roomId/instances/:instanceId/tools/list`
- `POST /rooms/:roomId/instances/:instanceId/tools/call`
- `POST /rooms/:roomId/instances/:instanceId/resources/list`
- `POST /rooms/:roomId/instances/:instanceId/resources/read`
- `POST /rooms/:roomId/instances/:instanceId/resources/templates/list`
- `POST /rooms/:roomId/instances/:instanceId/prompts/list`
- `POST /rooms/:roomId/instances/:instanceId/prompts/get`
- `POST /rooms/:roomId/instances/:instanceId/completion/complete`
- `POST /rooms/:roomId/instances/:instanceId/resources/subscribe`
- `POST /rooms/:roomId/instances/:instanceId/resources/unsubscribe`

`mount` is app/server-level (not tool-level). `roomd` inspects the upstream MCP
server, records tool catalog metadata, and selects a UI resource URI when one
is available. Non-UI mounts are valid and return `NO_UI_RESOURCE` on the `/ui`
endpoint.

## Server Targets

`server` accepts either:
- HTTP(S) URL (existing behavior)
- stdio descriptor:
  - `stdio://spawn?command=<cmd>&arg=<arg>&arg=<arg>&cwd=<cwd>&env.KEY=value`

Stdio safety:
- `ROOMD_STDIO_COMMAND_ALLOWLIST` controls allowed stdio commands.
- empty allowlist disables stdio by default.
- `*` allows all commands.

Mounted state persists negotiated session metadata:
- `protocolVersion`
- `capabilities`
- `extensions`
- `transport`
- `clientCapabilities` (advertised client capability negotiation snapshot)

Mount commands can include optional `clientCapabilities` with policy patches for:
- `roots`: enabled/listChanged + initial roots.
- `sampling`: enabled, HITL requirement, tool use, max tokens, default model.
- `elicitation`: enabled, form/url mode toggles, sensitive URL enforcement, default action.

## HTTP Security & Auth

Remote HTTP defaults are hardened:
- loopback HTTP targets are allowed by default.
- non-loopback HTTP targets are blocked unless `ROOMD_ALLOW_REMOTE_HTTP_SERVERS=true`.
- when remote HTTP is enabled, target origin must be in `ROOMD_REMOTE_HTTP_ORIGIN_ALLOWLIST` (or `*`).

Auth strategy is configured by server URL prefix via `ROOMD_HTTP_AUTH_CONFIG` JSON:

```json
{
  "http://127.0.0.1:3001/": { "type": "none" },
  "https://api.example.com/": { "type": "bearer", "token": "env-or-secret-value" },
  "https://oauth.example.com/": { "type": "oauth", "issuer": "https://issuer.example.com" }
}
```

Supported strategy types:
- `none`
- `bearer` (adds `Authorization: Bearer <token>`)
- `oauth` (placeholder boundary, returns typed `AUTH_DISCOVERY_FAILED` until interactive flow is implemented)

## Error Contract

All error responses use a stable shape:

```json
{
  "ok": false,
  "error": "message",
  "code": "ERROR_CODE",
  "details": {},
  "hint": "optional remediation"
}
```

Current canonical codes:
- `INVALID_PAYLOAD`
- `IDEMPOTENCY_CONFLICT`
- `ROOM_EXISTS`
- `ROOM_NOT_FOUND`
- `INSTANCE_EXISTS`
- `INSTANCE_NOT_FOUND`
- `SERVER_NOT_ALLOWLISTED`
- `UNSUPPORTED_CAPABILITY`
- `NO_UI_RESOURCE`
- `UI_RESOURCE_INVALID`
- `INVALID_COMMAND`
- `AUTH_REQUIRED`
- `AUTH_FAILED`
- `AUTH_DISCOVERY_FAILED`
- `UPSTREAM_TRANSPORT_ERROR`
- `INTERNAL_ERROR`

## Run

```bash
npm run --workspace services/roomd start
```

## CLI

The room CLI is now implemented in Go at `tools/roomctl/cmd/roomctl` and can be run from repo root:

```bash
npm run roomd:cli -- --help
```

## Conformance Client Runner

`roomd` includes a conformance client command used by the root Tier 2 CI gate:

```bash
npm run --workspace services/roomd conformance:client:run -- http://localhost:3000/mcp
```

The command is scenario-driven via `MCP_CONFORMANCE_SCENARIO` and currently
implements the `initialize` and `tools_call` scenarios used by the repo's
applicable Tier 2 conformance slice.
