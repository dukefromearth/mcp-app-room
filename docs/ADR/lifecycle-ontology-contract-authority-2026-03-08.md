# ADR: Lifecycle Ontology Contract Authority (2026-03-08)

## Status
Accepted

## Objective
Lock one canonical lifecycle ontology source that governs event vocabulary, route nouns, compatibility route policy metadata, and generated consumer constants for `roomd`, `host-web`, and `roomctl`.

## Context
Lifecycle event values were previously centralized, but route naming and compatibility/deprecation metadata were not represented in the same canonical artifact. That split made route-level behavior easy to diverge across server and consumers.

## Decision
`contracts/lifecycle-contract.json` is the canonical source for lifecycle ontology and event semantics.

This canonical contract now includes:

1. lifecycle event values (`hostLifecycleEvidenceEvents`),
2. default await event (`defaultAwaitEvidenceEvent`),
3. assurance levels (`assuranceLevels`),
4. ontology and route policy metadata (`ontology.*`), including:
   - canonical noun (`lifecycle`),
   - compatibility noun (`evidence`),
   - canonical ingestion route template,
   - compatibility ingestion route template,
   - compatibility status,
   - compatibility removal issue id,
   - compatibility sunset-not-before date.

## Source Of Truth
- Canonical artifact: `contracts/lifecycle-contract.json`
- Generator + drift checker: `tools/lifecycle-contract/sync.mjs`
- Generated consumers:
  - `services/roomd/src/lifecycle-contract.generated.ts`
  - `apps/host-web/src/room-canvas/lifecycle-contract.generated.ts`
  - `tools/roomctl/internal/roomctl/cli/lifecycle_contract_generated.go`

If this ADR and generated artifacts diverge, `contracts/lifecycle-contract.json` is authoritative and generated artifacts + ADR must be updated in the same change.

## Normative Contract Shape (JSON)
```json
{
  "version": 2,
  "hostLifecycleEvidenceEvents": ["bridge_connected", "resource_delivered", "app_initialized", "app_error"],
  "defaultAwaitEvidenceEvent": "app_initialized",
  "assuranceLevels": ["control_plane_ok", "ui_bridge_connected", "ui_resource_delivered", "ui_app_initialized"],
  "ontology": {
    "canonicalNoun": "lifecycle",
    "legacyCompatibilityNoun": "evidence",
    "canonicalIngressRoute": "/rooms/:roomId/instances/:instanceId/lifecycle",
    "compatibilityIngressRoute": "/rooms/:roomId/instances/:instanceId/evidence",
    "compatibilityStatus": "removed",
    "compatibilityRemovalIssue": 43,
    "compatibilitySunsetNotBefore": "2026-04-07"
  }
}
```

## Rationale
1. One artifact controls both nouns and events, eliminating semantic split between event enums and route policy.
2. Generated constants prevent copy/paste drift between TypeScript and Go consumers.
3. Compatibility policy metadata is explicit and machine-checkable, which supports deprecation gates and future compatibility removal work.

## Consequences
- Any lifecycle ontology change requires updating canonical JSON and regenerating outputs.
- Reviewers can audit lifecycle route/policy drift through one contract diff.
- Route implementation tickets (#30 and downstream) can consume constants instead of hardcoding semantics.

## Validation
Required commands for lifecycle contract edits:

```bash
npm run lifecycle-contract:sync
npm run lifecycle-contract:check
npm run verify:fast
```

## GOTCHA
Do not hardcode canonical or compatibility lifecycle route strings in multiple modules; import generated constants to avoid reintroducing ontology drift.
