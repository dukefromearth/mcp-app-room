# Title
Design Transport Adapter Contract and stdio Server Descriptor

# Priority
P1

# Estimated Size
M

# Depends On
- `01-capability-session-matrix.md`

# Context
roomd transport logic is embedded in MCP session factory with HTTP-first assumptions. Adding stdio safely requires a transport abstraction and descriptor contract.

# Goal
Define and implement a transport adapter interface and descriptor schema that cleanly supports streamable HTTP, legacy SSE fallback, and stdio.

# Out of Scope
- Full stdio runtime implementation (next ticket).

# Deliverables
- ADR-style design note for transport descriptor format and validation rules.
- `TransportAdapter` interface and registry in roomd MCP boundary.
- Parsing/validation for server descriptor values (URL vs stdio command descriptor).
- Unit tests for adapter selection and descriptor validation.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/mcp.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/schema.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/README.md`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`

# Implementation Plan
1. Propose descriptor format options and choose one with backward compatibility.
2. Add adapter interface and existing HTTP adapter implementation.
3. Add descriptor parser that routes to adapter by kind.
4. Keep existing `server` string input compatible for HTTP.
5. Add TODO/GOTCHA comments for unresolved stdio security constraints.

# TDD Plan (Required)
1. Add failing tests for descriptor parsing and invalid descriptor rejection.
2. Add failing tests for adapter selection (HTTP path unchanged).
3. Add failing tests confirming backward compatibility of existing URL input.

# Verification
- `npm run --workspace services/roomd test`
- `npm run --workspace services/roomd build`
- `npm run arch:lint`

# Acceptance Criteria
- Transport logic uses adapter abstraction, not hardcoded fallback branches.
- Existing HTTP behavior remains backward compatible.
- Descriptor contract is documented and validated.

# Rollback Plan
- Restore prior HTTP-only connect path and remove descriptor parser changes.

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
- Do not implement stdio execution in this ticket.
- Preserve current API contract for existing `server` URL callers.
