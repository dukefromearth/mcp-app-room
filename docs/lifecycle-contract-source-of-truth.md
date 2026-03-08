# Lifecycle Contract Source Of Truth

Lifecycle ontology and evidence semantics shared by `roomd`, `host-web`, and
`roomctl` are canonicalized in a single contract artifact:

- `contracts/lifecycle-contract.json`

The canonical artifact governs:

1. lifecycle event vocabulary (`hostLifecycleEvidenceEvents`),
2. default await event (`defaultAwaitEvidenceEvent`),
3. assurance levels (`assuranceLevels`),
4. lifecycle ontology and route policy metadata (`ontology`).

Generated consumers:

- `services/roomd/src/lifecycle-contract.generated.ts`
- `apps/host-web/src/room-canvas/lifecycle-contract.generated.ts`
- `tools/roomctl/internal/roomctl/cli/lifecycle_contract_generated.go`

Architecture decision record:

- `docs/ADR/lifecycle-ontology-contract-authority-2026-03-08.md`

## Commands

Regenerate consumers after canonical edits:

```bash
npm run lifecycle-contract:sync
```

Validate no drift (CI + verify:fast):

```bash
npm run lifecycle-contract:check
```

## Change Workflow

1. Edit `contracts/lifecycle-contract.json`.
2. Run `npm run lifecycle-contract:sync`.
3. Review generated file diffs.
4. Update linked ADR(s) when canonical fields or decisions change.
5. Run `npm run verify:fast`.

## GOTCHA

Do not hand-edit generated files. Drift checks intentionally fail when generated
consumers diverge from the canonical contract.
