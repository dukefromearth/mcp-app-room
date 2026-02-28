# Title
Reach Tier 1 Conformance and Publish Support Matrices + Deprecation Policy

# Priority
P0

# Estimated Size
L

# Depends On
- `05-conformance-ci-tier2-gate.md`
- `07-stdio-transport-implementation.md`
- `08-client-capabilities-roots-sampling-elicitation.md`
- `09-http-auth-strategy-and-security-hardening.md`

# Context
Final Q3 objective is Tier 1 readiness and clear external contracts for what roomd supports in core MCP vs Apps extension profile.

# Goal
Close remaining non-experimental conformance gaps to Tier 1 level and publish support/deprecation policy docs that stabilize v1 expectations.

# Out of Scope
- Experimental tasks full support.
- New extension implementations outside Apps profile.

# Deliverables
- Tier 1 conformance score in CI (applicable required tests).
- Public support matrix: protocol version, transports, capabilities, extension profile support.
- Backward-compatibility and deprecation policy (including legacy HTTP+SSE sunset criteria).
- Release readiness checklist tied to conformance + policy docs.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/README.md`
- `/Users/duke/Documents/github/mcp-app-room/docs/*`
- `/Users/duke/Documents/github/mcp-app-room/.github/workflows/*`
- `/Users/duke/Documents/github/mcp-app-room/services/roomd/README.md`

# Implementation Plan
1. Analyze failing conformance categories and map to concrete gaps.
2. Resolve highest-impact failures first, then rerun full suite.
3. Draft and publish support matrices (Core profile and Apps profile).
4. Define and publish transport deprecation timeline and compatibility guarantees.
5. Add release checklist gate requiring conformance evidence artifacts.

# TDD Plan (Required)
1. Start with failing conformance cases as red tests/checks.
2. For each fix, add or adjust local regression tests to prevent drift.
3. Add failing docs check that ensures support matrix includes required fields.

# Verification
- `npm run test:all`
- `npm run <conformance-script>`
- `npm run arch:lint`
- Manual docs sanity pass for matrix/policy consistency.

# Acceptance Criteria
- Tier 1 conformance target is met in CI with reproducible evidence.
- Support matrix and deprecation policy are published and referenced from main README.
- Release checklist includes conformance artifact and policy validation.

# Rollback Plan
- Keep Tier 2 gate as fallback and mark Tier 1 milestone as deferred.
- Do not ship partial policy docs without corresponding implementation status.

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
- Treat conformance failures as product requirements, not optional cleanup.
- Keep matrix values machine-checkable where possible.
