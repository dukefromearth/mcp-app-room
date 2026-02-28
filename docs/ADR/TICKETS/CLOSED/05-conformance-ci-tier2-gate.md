# Title
Integrate MCP Conformance in CI and Enforce Tier 2 Gate

# Priority
P0

# Estimated Size
M

# Depends On
- `01-capability-session-matrix.md`
- `02-core-server-primitives-parity.md`
- `03-mcp-apps-optional-mount-and-discovery.md`
- `04-roomd-error-taxonomy-and-surface-contracts.md`

# Context
roomd lacks objective protocol conformance gates. ADR requires Tier 2 threshold by end of Q2.

# Goal
Add automated conformance checks to CI and fail PRs when roomd drops below agreed Tier 2 threshold for applicable non-experimental tests.

# Out of Scope
- Hitting Tier 1 in this ticket.
- Experimental task coverage.

# Deliverables
- Conformance test job integrated in CI.
- Script to run conformance locally with deterministic config.
- Score reporting artifact in CI logs.
- Failing threshold gate configured at Tier 2 level.

# Files To Change
- `/Users/duke/Documents/github/mcp-app-room/.github/workflows/*`
- `/Users/duke/Documents/github/mcp-app-room/package.json`
- `/Users/duke/Documents/github/mcp-app-room/scripts/*`
- `/Users/duke/Documents/github/mcp-app-room/README.md`

# Implementation Plan
1. Add conformance runner script (pin versions, deterministic inputs).
2. Add CI job and cache strategy.
3. Add threshold parser that fails below target score.
4. Document local workflow and known exclusions.

# TDD Plan (Required)
1. Add failing check run by setting a temporary impossible threshold and prove gate behavior.
2. Add test for threshold parser script using fixture outputs.

# Verification
- `npm run test`
- `npm run test:go`
- `npm run <new-conformance-script>`
- CI dry run in branch with one intentional failure then success.

# Acceptance Criteria
- CI includes a reproducible conformance stage.
- Stage reports conformance score and enforced threshold.
- PRs fail when score drops below configured Tier 2 target.
- Contributor docs explain local conformance runs and troubleshooting.

# Rollback Plan
- Disable CI conformance gate via workflow toggle while preserving scripts.

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
- Pin tooling versions to avoid flaky pass/fail drift.
- Keep exclusions explicitly documented and time-bounded.
