# roomd MCP Roadmap Tickets (Q2-Q3 2026)

This folder contains implementation tickets derived from:

- `/Users/duke/Documents/github/mcp-app-room/docs/ADR/mcp-adr-02-28-2026.md`

Execution order (recommended):

1. `01-capability-session-matrix.md`
2. `02-core-server-primitives-parity.md`
3. `03-mcp-apps-optional-mount-and-discovery.md`
4. `04-roomd-error-taxonomy-and-surface-contracts.md`
5. `05-conformance-ci-tier2-gate.md`
6. `06-transport-adapter-architecture-and-stdio-design.md`
7. `07-stdio-transport-implementation.md`
8. `08-client-capabilities-roots-sampling-elicitation.md`
9. `09-http-auth-strategy-and-security-hardening.md`
10. `10-tier1-conformance-support-matrices-and-deprecation.md`

Milestone targets:

- End of Q2 2026: Tier 2 conformance threshold and Apps-safe non-UI-first behavior.
- End of Q3 2026: Tier 1 conformance threshold, stdio support, auth hardening, published support matrices.

## First PR Decision

Start with `03-mcp-apps-optional-mount-and-discovery.md` as a focused,
user-visible safety slice, then execute the core protocol hardening sequence:

1. `03-mcp-apps-optional-mount-and-discovery.md`
2. `01-capability-session-matrix.md`
3. `02-core-server-primitives-parity.md`
4. `04-roomd-error-taxonomy-and-surface-contracts.md`

Rationale:
- Current host and CLI behavior is blocked by UI-first mount assumptions, so a
  non-UI-safe mount path is the highest product-risk reducer.
- Ticket `01` remains foundational for capability contracts and is executed
  immediately after `03` to restore strict protocol-first guardrails.
