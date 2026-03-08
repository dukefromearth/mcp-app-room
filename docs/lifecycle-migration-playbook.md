# Lifecycle Migration Playbook

This playbook is the canonical migration guide for lifecycle-route convergence in
`roomd`, `host-web`, `roomctl`, scripts, and tests.

<!-- lifecycle-migration-playbook:json:start -->
{
  "programIssue": 37,
  "documentationIssue": 42,
  "compatibilityRemovalIssue": 43,
  "canonicalLifecycleRoute": "/rooms/:roomId/instances/:instanceId/lifecycle",
  "compatibilityLifecycleRoute": "/rooms/:roomId/instances/:instanceId/evidence",
  "duplicateCreateContract": {
    "firstCreateStatus": 201,
    "duplicateCreateStatus": 200,
    "duplicateCreatedFlag": false
  },
  "compatibilityTelemetryGate": {
    "trackingSignal": "lifecycle.compatibility_route_hit",
    "windowDays": 30,
    "maxCompatibilityRequestsPerDay": 0
  }
}
<!-- lifecycle-migration-playbook:json:end -->

## Canonical Contract

- Canonical lifecycle ingress:
  `POST /rooms/:roomId/instances/:instanceId/lifecycle`
- Compatibility alias during deprecation window:
  `POST /rooms/:roomId/instances/:instanceId/evidence`
- Canonical room create idempotency:
  - first create: `201` with `{ ok: true, created: true, state }`
  - duplicate create: `200` with `{ ok: true, created: false, state }`

## Route Migration: Before and After

### HTTP route usage

Before:

```text
POST /rooms/:roomId/instances/:instanceId/evidence
```

After:

```text
POST /rooms/:roomId/instances/:instanceId/lifecycle
```

### Duplicate create handling

Before (stale assumption):

```text
POST /rooms -> 409 ROOM_EXISTS on duplicate
```

After (canonical idempotent contract):

```text
POST /rooms -> 200 { ok: true, created: false, state } on duplicate
```

## Deprecation Gate for Compatibility Route

The `/evidence` compatibility alias remains deprecated until issue `#43` is
explicitly unblocked and merged.

Removal gate criteria:

1. Compatibility telemetry signal `lifecycle.compatibility_route_hit` is at most
   `0` requests/day for `30` consecutive days.
2. First-party consumers remain canonical-route only.
3. Contract suite passes with compatibility route removed.

## Verification

- `npm run docs:check`
- `npm run verify:fast`

