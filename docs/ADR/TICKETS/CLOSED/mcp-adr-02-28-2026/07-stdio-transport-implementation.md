# Title
Implement stdio Transport Adapter for Local MCP Servers

# Status
Closed (implemented together with Ticket 06 on 2026-02-28)

# Priority
P1

# Estimated Size
L

# Depends On
- `06-transport-adapter-architecture-and-stdio-design.md`

# Context
Core spec recommends stdio support whenever possible. roomd currently supports HTTP-based transports only.

# Goal
Implement stdio adapter support with secure process lifecycle management and parity with existing session behavior.

# Out of Scope
- OAuth/auth for stdio (credentials remain environment-based).
- New room commands unrelated to transport selection.

# Deliverables
- stdio transport adapter implementation.
- Child process lifecycle handling with graceful shutdown.
- Configurable command/args/env descriptor support.
- Integration tests for connect, request, and shutdown behavior.
- docs/CLI examples for stdio mounts.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/mcp.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`
- `/Users/duke/Documents/github/mcp-app-room/docs/cli/CLI_QUICK_START.md`

# Implementation Plan
1. Implement stdio adapter using MCP SDK stdio client transport.
2. Enforce command allowlist / safe execution constraints from roomd config.
3. Add timeout + cancellation semantics parity with HTTP sessions.
4. Ensure unmount/shutdown closes stdio subprocess cleanly.
5. Add route-level smoke test against a fixture local MCP server.

# TDD Plan (Required)
1. Add failing test: stdio descriptor creates working session and serves `tools/list`.
2. Add failing test: invalid stdio command descriptor rejected at validation boundary.
3. Add failing test: session shutdown terminates subprocess.

# Verification
- `npm run --workspace services/roomd test`
- `npm run --workspace services/roomd build`
- `npm run test:all`

# Acceptance Criteria
- roomd can connect to local MCP servers via stdio using documented descriptor.
- Process lifecycle is deterministic and does not leak child processes.
- Existing HTTP/SSE paths remain unchanged.

# Rollback Plan
- Disable stdio adapter in adapter registry while keeping descriptor parser stubs.

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
- Validate process cleanup locally with repeated connect/unmount loops.
- Add a GOTCHA comment where subprocess kill fallback is implemented.
