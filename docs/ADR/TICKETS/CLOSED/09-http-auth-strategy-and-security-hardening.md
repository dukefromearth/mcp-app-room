# Title
Implement HTTP Auth Strategy Abstraction and Security Hardening for Remote MCP Servers

# Priority
P1

# Estimated Size
L

# Depends On
- `01-capability-session-matrix.md`
- `06-transport-adapter-architecture-and-stdio-design.md`

# Context
Authorization is optional in MCP, but HTTP transports should follow authorization specs when enabled. roomd currently lacks a clear auth strategy layer and remote-server hardening policy surface.

# Goal
Add pluggable auth strategies for HTTP MCP sessions and enforce secure defaults for remote server connectivity.

# Out of Scope
- Full OAuth UX integration in host-web.
- Enterprise extension-specific auth flows.

# Deliverables
- Auth strategy interface (none, bearer token, extensible OAuth-ready hooks).
- Config model for per-server auth settings.
- Origin and server allowlist hardening checks.
- Structured auth errors (`AUTH_REQUIRED`, `AUTH_FAILED`, `AUTH_DISCOVERY_FAILED`).
- Security docs and operational guidance.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/mcp.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/README.md`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`

# Implementation Plan
1. Add auth strategy abstraction and default strategy selection.
2. Implement bearer-token path for configured servers.
3. Wire strategy into transport/session creation.
4. Add secure defaults: strict allowlist + explicit opt-in for remote origins.
5. Add docs with rollout/migration guidance.

# TDD Plan (Required)
1. Add failing tests for authenticated vs unauthenticated session initialization.
2. Add failing tests for auth failure mapping to typed errors.
3. Add failing tests for blocked remote server by policy.

# Verification
- `npm run --workspace services/roomd test`
- `npm run --workspace services/roomd build`
- `npm run arch:lint`

# Acceptance Criteria
- HTTP sessions can apply configured auth strategies without changing call sites.
- Auth failures are explicit and typed.
- Remote connection policy defaults are secure and documented.

# Rollback Plan
- Force strategy to `none` and disable auth path while preserving config shape.

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
- Keep strategy implementations isolated; avoid auth conditionals spread across store logic.
- Add GOTCHA comments for token refresh assumptions if implemented.
