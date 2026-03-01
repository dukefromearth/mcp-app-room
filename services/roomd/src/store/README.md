# roomd/src/store

Internal `RoomStore` seams used to keep `store.ts` focused on orchestration:

- `layout.ts`: pure layout operation normalization and mutation planning.
- `parsing.ts`: MCP payload parsing/normalization and clone helpers.
- `server-policy.ts`: server allowlist policy checks and hints.

These modules are internal-only and must preserve existing `RoomStore` external behavior.
