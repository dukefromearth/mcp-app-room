# Title
Standardize roomd Error Taxonomy Across HTTP and CLI Surfaces

# Status
Closed (implemented in combined delivery with Ticket 01 on 2026-02-28)

# Priority
P1

# Estimated Size
M

# Depends On
- `01-capability-session-matrix.md`
- `03-mcp-apps-optional-mount-and-discovery.md`

# Context
Error responses are partially normalized and still vary by path. Stable SDK contracts require deterministic error codes and payload shape for retries, UX, and automation.

# Goal
Define and enforce a stable roomd error taxonomy with consistent shape across HTTP responses and roomctl output.

# Out of Scope
- Internationalization/localization of messages.
- Exhaustive remapping of third-party error text.

# Deliverables
- Error code registry document.
- Centralized error factory/mapping in roomd.
- CLI formatting that surfaces code, message, and actionable hints.
- Contract tests that lock shape for key failure classes.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/tools/roomctl/internal/roomctl/cli/root.go`
- `/Users/duke/Documents/github/mcp-app-room/tools/roomctl/internal/roomctl/cli/integration_test.go`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/README.md`

# Implementation Plan
1. Define canonical error codes and minimum response fields.
2. Replace ad-hoc `HttpError` construction with typed constructors.
3. Ensure all route handlers return error bodies via shared mapping path.
4. Update CLI pretty output to always print code if present.
5. Add docs table with code, meaning, and retry guidance.

# TDD Plan (Required)
1. Add failing tests that assert exact error shape for:
   - unsupported capability
   - missing UI resource
   - invalid payload
   - upstream transport failure
2. Add failing CLI integration test for pretty output error hint format.

# Verification
- `npm run --workspace services/roomd test`
- `go test ./tools/roomctl/...`
- `npm run test:all`

# Acceptance Criteria
- Error responses for all roomd endpoints include stable fields (`ok`, `error`, `code`, optional details).
- CLI shows deterministic error codes and hint text in pretty mode.
- Docs include a maintained error code reference.

# Rollback Plan
- Revert to prior error body format while keeping new docs marked experimental.

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
- Avoid changing HTTP status code semantics unless explicitly required by spec.
- Keep code names short and machine-friendly.
