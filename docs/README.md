# Documentation Index

This directory contains repository governance and architecture documentation.

## Quick Links

- `architecture-linting.md`: dependency boundary governance and enforcement policy.
- `cli/CLI_QUICK_START.md`: canonical CLI usage guide.
- `repository-setup.md`: local anti-pattern guardrails for scalable repository shape.
- `architecture/README.md`: curated architecture documentation entrypoint.
- `roomd-support-matrix.md`: v1 support matrix (core profile + Apps profile).
- `roomd-deprecation-policy.md`: compatibility and transport deprecation policy.
- `roomd-release-readiness-checklist.md`: release gate checklist tied to conformance evidence.

## Update Workflow

When architecture or repository boundaries change:

1. Update the relevant policy docs in this directory.
2. Regenerate architecture artifacts: `npm run arch`.
3. Validate local governance checks: `npm run verify:fast`.
