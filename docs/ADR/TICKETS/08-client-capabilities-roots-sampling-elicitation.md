# Title
Add Client Capability Support Modules (Roots, Sampling, Elicitation)

# Priority
P1

# Estimated Size
XL

# Depends On
- `01-capability-session-matrix.md`
- `02-core-server-primitives-parity.md`

# Context
First-class MCP host support requires client-side capabilities in addition to server primitive passthrough. roomd currently has no dedicated modules for roots/sampling/elicitation.

# Goal
Introduce client-capability modules for roots, sampling, and elicitation with explicit negotiation checks and safe defaults.

# Out of Scope
- Full end-user UX flows for elicitation URL mode in host-web.
- Experimental tasks augmentation.

# Deliverables
- Module boundaries for `roots`, `sampling`, `elicitation` in roomd core.
- Endpoint/API contract to configure roots and trigger sampling/elicitation workflow adapters.
- Capability negotiation guards for client requests.
- Security-focused defaults (human-in-the-loop hooks, sensitive-data restrictions).

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/types.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/store.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/server.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/schema.ts`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/src/README.md`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/tests/store.test.ts`

# Implementation Plan
1. Add internal interfaces for client capability handlers and capability checks.
2. Implement roots list/change handling first (lowest complexity).
3. Implement sampling request adapter with policy hooks and explicit opt-in.
4. Implement elicitation adapter with mode checks; enforce URL mode constraints for sensitive interactions.
5. Add docs for capability prerequisites and safety hooks.

# TDD Plan (Required)
1. Add failing tests for roots capability absent/present behavior.
2. Add failing tests for sampling request rejection without capability.
3. Add failing tests for elicitation mode negotiation and sensitive-mode constraints.
4. Add one black-box flow test per module.

# Verification
- `npm run --workspace services/roomd test`
- `npm run --workspace services/roomd build`
- `npm run arch:lint`

# Acceptance Criteria
- roots/sampling/elicitation behavior is capability-gated and deterministic.
- Unsupported client capability use returns typed errors.
- Safety hooks are documented and wired for policy control.

# Rollback Plan
- Feature-flag modules off while preserving type interfaces.

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
- Implement roots first, then sampling, then elicitation.
- Keep each capability in separate files to avoid a new god module.
