# Documentation Index

This directory contains repository governance and architecture documentation.

## Quick Links

- `architecture-linting.md`: dependency boundary governance and enforcement policy.
- `repository-setup.md`: local anti-pattern guardrails for scalable repository shape.
- `architecture/README.md`: curated architecture documentation entrypoint.
- `ADR/README.md`: architecture decision record index.
- `roomd-support-matrix.md`: v1 support matrix (core profile + Apps profile).
- `roomd-deprecation-policy.md`: compatibility and transport deprecation policy.
- `roomd-release-readiness-checklist.md`: release gate checklist tied to conformance evidence.
- `real-mcp-integration-testing.md`: canonical real MCP integration fixture and test workflow.
- `lifecycle-contract-source-of-truth.md`: canonical lifecycle contract and drift-check workflow.
- `upstream-ext-apps-strict-init-reproducer.md`: upstream strict-init dependency tracking and blocker record.

## Update Workflow

When architecture or repository boundaries change:

1. Update the relevant policy docs in this directory.
2. Update impacted ADRs under `docs/ADR/` if contract authority changed.
3. Regenerate architecture artifacts: `npm run arch`.
4. Validate local governance checks: `npm run verify:fast`.
