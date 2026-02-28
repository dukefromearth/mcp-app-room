# roomd/src

Runtime and domain modules for the room control plane.

## Boundaries

- Foundation files (`types.ts`, `schema.ts`, `hash.ts`) must stay runtime-agnostic.
- `store.ts` owns room state transitions and command semantics.
- `mcp.ts` and `server.ts` are integration/adapters and may import external SDKs.

## Main files

- `server.ts`: HTTP/SSE adapter.
- `store.ts`: room domain model and command processing.
- `mcp.ts`: external MCP integration boundary.

`server.ts` exposes mounted-instance MCP passthrough routes for tools/resources/prompts,
including `tools/list` and `tools/call`.

`tools/call` is stateful at the room layer: direct calls are mirrored into
`RoomState.invocations` and emit `state-updated` events (`call`, then
`call-result` or `call-failed`) so room clients update without manual refresh.
