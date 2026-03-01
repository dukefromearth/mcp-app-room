# Title
Make MCP Apps Optional in Mount Semantics and Discovery

# Status
Closed (merged via PR #2 on 2026-02-28)

# Priority
P0

# Estimated Size
L

# Depends On
None (executed as the first PR slice)

# Context
Current mount flow assumes UI availability and hard-fails when UI discovery is ambiguous or unavailable. Apps spec defines UI as extension behavior and allows servers to omit UI-only resources from `resources/list`.

# Goal
Refactor mount and inspection paths so non-UI servers are first-class and MCP Apps behavior is opt-in, metadata-first, and best-effort.

# Out of Scope
- Replacing sandbox implementation.
- Full Apps visibility policy engine across all host surfaces.

# Deliverables
- Mount no longer requires resolved `uiResourceUri`.
- `inspect/server` handles `resources/list` failures best-effort and still returns tool-derived data.
- `/instances/:id/ui` returns typed no-UI error when mount has no UI.
- host-web renders graceful non-UI mount tile state.
- Docs updated to reflect optional Apps behavior and fallback paths.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`
- `/Users/duke/Documents/github/mcp-app-room/apps/host-web/src/room-canvas.tsx`
- `/Users/duke/Documents/github/mcp-app-room/apps/host-web/src/README.md`

# Implementation Plan
1. Make `RoomMount.uiResourceUri` optional in state model.
2. Change `inspectServerWithSession` to tolerate `resources/list` failure and continue with tool metadata.
3. Update mount selection rules:
   - if explicit URI is provided, validate when candidate set is known
   - if no URI and one candidate, auto-select
   - if no URI and none/ambiguous, allow mount without UI
4. Return `NO_UI_RESOURCE` (typed 404/409) from UI read endpoint when no UI exists.
5. Update web tile rendering to show non-UI state and keep tool operations usable.

# TDD Plan (Required)
1. Add failing test: mount succeeds when no UI candidates exist.
2. Add failing test: inspection succeeds even when `listResources` throws.
3. Add failing test: UI endpoint returns typed no-UI error for non-UI mount.
4. Add failing e2e test: room canvas displays mounted instance without requiring UI resource.

# Verification
- `npm run --workspace services/roomd test`
- `npm run playwright:test -- e2e/playwright/shared-session-canvas.spec.ts`
- `npm run --workspace apps/host-web build`

# Acceptance Criteria
- Mounting a non-UI MCP server succeeds and remains operable for tools/resources/prompts.
- Server inspection never hard-fails solely due to `resources/list` unavailability.
- UI route returns a stable typed error when UI is absent.
- Host UI clearly indicates non-UI mounts without crashing or hiding the mount.

# Rollback Plan
- Restore previous mount validation requiring UI candidates.
- Keep new tests skipped with explicit TODO if rollback is temporary.

# Definition of Done
- [ ] Acceptance criteria met.
- [ ] Red tests were committed first (or clearly shown in PR timeline).
- [ ] Test/build/typecheck pass for touched packages.
- [ ] Migration notes updated.
- [ ] Junior handoff section in PR description:
  - what changed
  - how to run tests
  - how to verify locally

Junior handoff notes:
- Preserve existing error codes where possible; add new codes without breaking existing parsers.
- Keep Apps-specific logic in clearly named helpers to avoid reintroducing core coupling.
