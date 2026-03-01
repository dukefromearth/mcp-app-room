# host-web/src

UI shell for the room host application.

## Boundaries

- Keep MCP SDK imports in boundary modules (`implementation.ts`, `sandbox.ts`).
- Keep presentational logic isolated from bridge/integration logic.
- Avoid adding cross-domain state here; room state authority belongs to `services/roomd`.

## Main files

- `index.tsx`: app entrypoint.
- `room-canvas.tsx`: room-focused container/orchestration.
- `room-canvas/*`: room-canvas internal seams (roomd client adapter, SSE lifecycle, bridge wiring, per-instance rendering).
- `implementation.ts`: bridge composition boundary.

`room-canvas.tsx` renders mounted app/server instances and must not assume a
required `mount.toolName`; mount identity comes from `instanceId` and
optional `uiResourceUri`.
