# Title
Add Missing Core Server Primitive Endpoints (Prompts/Get, Completion, Resource Subscriptions)

# Priority
P0

# Estimated Size
L

# Depends On
- `01-capability-session-matrix.md`

# Context
roomd surfaces list/call/read operations but is missing some non-experimental server primitives needed for first-class MCP support.

# Goal
Expose missing core primitives through roomd instance endpoints with capability-aware guards and stable contracts.

# Out of Scope
- Tasks support.
- Extension-specific APIs.

# Deliverables
- `prompts/get` passthrough endpoint.
- `completion/complete` passthrough endpoint.
- `resources/subscribe` and `resources/unsubscribe` passthrough endpoints.
- Route-level capability checks and consistent error mapping.
- CLI commands for new endpoints where applicable.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/mcp.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/tools/roomctl/internal/roomctl/cli/root.go`
- `/Users/duke/Documents/github/mcp-app-room/tools/roomctl/internal/roomctl/roomd/client.go`
- `/Users/duke/Documents/github/mcp-app-room/tools/roomctl/internal/roomctl/cli/integration_test.go`
- `/Users/duke/Documents/github/mcp-app-room/docs/cli/CLI_QUICK_START.md`

# Implementation Plan
1. Align request/response shapes with MCP schema for each method.
2. Add store and MCP session methods for prompt get, completion, subscribe, unsubscribe.
3. Add HTTP endpoints in `server.ts` with payload validation and capability guards.
4. Add CLI commands and integration tests for all new routes.
5. Update quick start docs with example invocations.

# TDD Plan (Required)
1. Add failing roomd tests for each new endpoint behavior (happy path + unsupported capability).
2. Add failing CLI integration tests that assert HTTP method/path/payload.
3. Add one end-to-end smoke check that exercises at least one new route via CLI.

# Verification
- `npm run --workspace services/roomd test`
- `go test ./tools/roomctl/...`
- `npm run test:all`
- `npm run arch:lint`

# Acceptance Criteria
- roomd exposes endpoints for `prompts/get`, `completion/complete`, `resources/subscribe`, and `resources/unsubscribe`.
- Each endpoint returns deterministic unsupported-capability errors when capability is missing.
- CLI exposes corresponding commands with help text and example docs.
- Tests cover route shape, capability guards, and one CLI round-trip.

# Rollback Plan
- Remove newly added endpoints and CLI commands.
- Keep internal interfaces backward-compatible by leaving existing methods untouched.

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
- Use MCP schema docs to avoid inventing payload fields.
- Keep route names parallel to existing pattern under `/instances/:instanceId/...`.
