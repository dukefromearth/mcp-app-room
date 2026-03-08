# roomd/src

Runtime and domain modules for the room control plane.

## Boundaries

- Foundation files (`types.ts`, `schema.ts`, `hash.ts`) must stay runtime-agnostic.
- `store.ts` owns room state transitions and command semantics.
- `mcp.ts` and `server.ts` are integration/adapters and may import external SDKs.
- `capabilities.ts` is the shared capability guard for all mounted-instance routes.
- `client-capabilities/*` owns roots/sampling/elicitation policy config and evaluation.
- `errors.ts` is the canonical roomd error taxonomy and response mapper.
- `server-target.ts` is the canonical parser/normalizer for HTTP and stdio server descriptors.

## Main files

- `server.ts`: HTTP/SSE adapter.
- `store.ts`: room domain model and command processing.
- `mcp.ts`: external MCP integration boundary.
- `store/*`: internal `RoomStore` seams (`layout`, parsing/clone helpers, server policy checks) extracted for localized refactors only; no external contract changes.

`server.ts` exposes mounted-instance MCP passthrough routes for
tools/resources/prompts/completion (including prompt get and resource
subscription endpoints), plus server inspection (`POST /inspect/server`) for
pre-mount discovery.

`server.ts` also exposes runtime client-capability endpoints per instance for:
- roots configuration and list-changed notifications.
- sampling policy updates + deterministic preview evaluation.
- elicitation policy updates + deterministic preview evaluation.

`tools/call` is stateful at the room layer: direct calls are mirrored into
`RoomState.invocations` and emit `state-updated` events (`call`, then
`call-result` or `call-failed`) so room clients update without manual refresh.

Room creation route contract is idempotent:
- `POST /rooms`
  - first create returns `201` with `{ ok: true, created: true, state }`
  - duplicate create returns `200` with `{ ok: true, created: false, state }`

Room state now also carries protocol-level lifecycle evidence and assurance:
- `RoomState.evidence[]`: append-only evidence records (`room_created`, `mount_applied`, `rpc_*`, and host/app lifecycle events).
- `RoomState.assurance`: per-instance proven/unknown summaries derived from evidence.

Host lifecycle events are ingested via:
- canonical: `POST /rooms/:roomId/instances/:instanceId/lifecycle`
- compatibility alias (deprecated): `POST /rooms/:roomId/instances/:instanceId/evidence`
  - both routes accept events: `bridge_connected`, `resource_delivered`, `app_initialized`, `app_error`
  - source: `host` or `app`

Mount commands are app/server-level and persist:
- optional `uiResourceUri` at the mount level.
- optional `clientCapabilities` policy patch at mount time.
- full discovered `tools[]` catalog (name, schema, metadata) at the mount level.
- negotiated session metadata (`protocolVersion`, `capabilities`, `extensions`, `transport`, `clientCapabilities`).
