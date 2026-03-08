# Lifecycle Contract Tooling

This workspace owns canonical lifecycle contract synchronization and drift checks.

- Canonical source: `contracts/lifecycle-contract.json`
- Generator/check script: `tools/lifecycle-contract/sync.mjs`
- ADR authority: `docs/ADR/lifecycle-ontology-contract-authority-2026-03-08.md`

The canonical contract includes event semantics and lifecycle ontology policy
metadata (canonical noun, compatibility noun, canonical/compatibility routes,
deprecation status, and compatibility removal metadata).

Commands:

```bash
npm run lifecycle-contract:sync
npm run lifecycle-contract:check
```
