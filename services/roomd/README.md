# roomd

`roomd` is a minimal room control-plane service for shared-session canvas hosting.

## Endpoints

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

## Run

```bash
npm run --workspace services/roomd start
```

## CLI

The room CLI is now implemented in Go at `tools/roomctl/cmd/roomctl` and can be run from repo root:

```bash
npm run roomd:cli -- --help
```
