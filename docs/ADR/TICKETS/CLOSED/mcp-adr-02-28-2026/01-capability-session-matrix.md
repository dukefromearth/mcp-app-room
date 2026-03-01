# Title
Capability Matrix and Session Metadata Contract

# Status
Closed (implemented in combined delivery with Ticket 04 on 2026-02-28)

# Priority
P0

# Estimated Size
L

# Depends On
None

# Context
`roomd` currently proxies MCP primitives but does not persist a normalized per-session capability matrix. This leads to UI-first assumptions and late runtime failures when servers do not support specific capabilities.

# Goal
Persist negotiated MCP protocol and capability state per mounted session, and enforce capability-aware routing before any upstream call.

# Out of Scope
- Adding new MCP operations not already surfaced in roomd.
- Implementing stdio transport.

# Deliverables
- Session model extended with negotiated protocol version, server capabilities, extension settings, transport kind.
- A reusable capability guard utility used by all instance endpoints.
- Typed roomd errors for unsupported capability paths.
- Documentation updates in roomd READMEs describing the new contract.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/mcp.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/README.md`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`

# Implementation Plan
1. Add canonical `NegotiatedSession` type and store it per mount/session key.
2. During initialization, persist negotiated protocol version and returned server capabilities.
3. Implement a shared guard function that checks required capability before route execution.
4. Apply guard to tools/resources/prompts/capabilities routes.
5. Return stable roomd-level error code for unsupported operations.
6. Update docs and examples to clarify capability-gated behavior.

# TDD Plan (Required)
1. Add failing test: calling a capability-dependent route against a session lacking that capability returns `UNSUPPORTED_CAPABILITY`.
2. Add failing test: capability-present session succeeds through the same route.
3. Add failing test: session metadata includes negotiated protocol/capabilities in state output.

# Verification
- `npm run --workspace services/roomd test`
- `npm run --workspace services/roomd build`
- `npm run arch:lint`

# Acceptance Criteria
- Instance endpoints no longer call upstream methods when capability is absent.
- Errors for unsupported operations are deterministic and include a stable code.
- Mounted session state includes negotiated protocol and capability metadata.
- roomd docs reflect capability-gated behavior and error semantics.

# Rollback Plan
- Revert session metadata fields and capability guard usage in one patch.
- Keep route behavior as direct passthrough if rollout causes incompatibility.

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
- Start in `store.ts` and follow session creation path first.
- Avoid mixing capability checks with transport code; use a dedicated guard helper.
