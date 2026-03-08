# ADR Index

Architecture Decision Records (ADRs) in this directory lock repo-level contract and policy decisions that must remain stable across refactors.

## Active ADRs

- `dev-sidebar-protocol-console-contracts-2026-02-28.md`: contract-first protocol console shape for host dev sidebar.
- `lifecycle-ontology-contract-authority-2026-03-08.md`: canonical lifecycle ontology, route naming, and compatibility policy metadata authority.

## Workflow

1. Update the canonical source artifact first (code/schema/contract JSON).
2. Regenerate any generated outputs.
3. Update the linked ADR in the same change.
4. Run `npm run verify:fast`.

## GOTCHA

Do not remove ADR files referenced by drift checks without updating the corresponding checker script in the same change.
