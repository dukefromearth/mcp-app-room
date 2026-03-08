# Upstream ext-apps Strict Init Reproducer

## Scope

This note tracks the strict-mode initialization idempotency dependency gap in
`@modelcontextprotocol/ext-apps` and the local controls in `mcp-app-room`.

## Upstream Status (as of 2026-03-08)

- Upstream issue: [modelcontextprotocol/ext-apps#542](https://github.com/modelcontextprotocol/ext-apps/issues/542)
- Upstream PR: [modelcontextprotocol/ext-apps#543](https://github.com/modelcontextprotocol/ext-apps/pull/543)
- Upstream state: issue `OPEN`, PR `OPEN` (not merged)
- Latest npm release observed: `@modelcontextprotocol/ext-apps@1.2.0` (published 2026-03-06)

## Local Reproducer Signals

Canonical positive lifecycle suite:

```bash
npm run test:integration:real-mcp
```

Primary regression lock:

- `e2e/playwright/roomctl-real-server-host-lifecycle.e2e.spec.ts`
  - requires `app_initialized` evidence for mounted host instance
  - asserts no duplicate host `app_initialized` event for the same instance

This prevents silent regressions where strict-mode transport sequencing accepts
duplicate lifecycle progression.

## Local Defense-In-Depth

- Host room bootstrap keeps bridge wiring + evidence reporting isolated in
  `apps/host-web/src/room-canvas/room-app-instance.tsx`.
- Dependency is pinned to exact `@modelcontextprotocol/ext-apps@1.2.0` in
  workspace manifests to prevent unreviewed semver drift while upstream
  lifecycle issue remains open.

## Validation Snapshot (2026-03-08)

Pin trial + required gates on `1.2.0`:

- `npm run verify` passed
- `npm run test:integration:real-mcp` passed

Interpretation:

- This repository's strict lifecycle locks pass on `1.2.0`.
- Upstream strict-init tracking issue remains open, so keep this ticket as an
  external dependency watch until upstream closes with root-cause resolution.

## Blocker Record

- Owner: `team-platform` (this repository), `modelcontextprotocol/ext-apps` maintainers (upstream)
- Blocked since: 2026-03-08
- Earliest next check: 2026-03-15
- Exit criteria:
  1. Upstream PR merges.
  2. Upstream package release contains fix.
  3. This repo pins to released fixed version and reruns `npm run verify` and
     `npm run test:integration:real-mcp`.

## GOTCHA

Do not relax the duplicate `app_initialized` assertion to make flaky runs pass.
If this assertion fails, treat it as lifecycle truth regression and escalate.
