# roomd MCP Roadmap Tickets (Q2-Q3 2026)

This folder contains implementation tickets derived from:

- `/Users/duke/Documents/github/mcp-app-room/docs/ADR/mcp-adr-02-28-2026.md`

Execution order (recommended):

1. `08-client-capabilities-roots-sampling-elicitation.md`
2. `09-http-auth-strategy-and-security-hardening.md`
3. `10-tier1-conformance-support-matrices-and-deprecation.md`

Milestone targets:

- End of Q2 2026: Tier 2 conformance threshold and Apps-safe non-UI-first behavior.
- End of Q3 2026: Tier 1 conformance threshold, stdio support, auth hardening, published support matrices.

## Closed

- `01-capability-session-matrix.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28 (combined with ticket 04)
- `02-core-server-primitives-parity.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28
- `03-mcp-apps-optional-mount-and-discovery.md`
  - moved to `CLOSED/`
  - merged via PR #2 on 2026-02-28
- `04-roomd-error-taxonomy-and-surface-contracts.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28 (combined with ticket 01)
- `06-transport-adapter-architecture-and-stdio-design.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28 (combined with ticket 07)
- `07-stdio-transport-implementation.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28 (combined with ticket 06)
- `05-conformance-ci-tier2-gate.md`
  - moved to `CLOSED/`
  - completed on 2026-02-28

## Next Up

1. `08-client-capabilities-roots-sampling-elicitation.md`
2. `09-http-auth-strategy-and-security-hardening.md`
   Recommended to combine with ticket 08 in one PR: shared capability/auth boundaries in `mcp.ts`, `store.ts`, `server.ts`, and `types.ts`.
3. `10-tier1-conformance-support-matrices-and-deprecation.md`
