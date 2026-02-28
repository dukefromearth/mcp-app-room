# host-web/src

UI shell for the room host application.

## Boundaries

- Keep MCP SDK imports in boundary modules (`implementation.ts`, `sandbox.ts`).
- Keep presentational logic isolated from bridge/integration logic.
- Avoid adding cross-domain state here; room state authority belongs to `services/roomd`.

## Main files

- `index.tsx`: app entrypoint.
- `room-canvas.tsx`: room-focused rendering and interactions.
- `implementation.ts`: bridge composition boundary.
