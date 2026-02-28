# Documentation Index

This directory contains repository governance and architecture documentation.

## Quick Links

- `architecture-linting.md`: dependency boundary governance and enforcement policy.
- `cli/CLI_QUICK_START.md`: canonical CLI usage guide.
- `repository-setup.md`: local anti-pattern guardrails for scalable repository shape.
- `architecture/README.md`: curated architecture documentation entrypoint.
- `generated/README.md`: generated architecture artifact contract and regeneration workflow.

## Update Workflow

When architecture or repository boundaries change:

1. Update the relevant policy docs in this directory.
2. Regenerate architecture artifacts: `npm run arch:gen`.
3. Validate local governance checks: `npm run check:dev`.
