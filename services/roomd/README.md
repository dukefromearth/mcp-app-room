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

Mounted state persists negotiated session metadata:
- `protocolVersion`
- `capabilities`
- `extensions`
- `transport`

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
