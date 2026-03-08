# roomd Compatibility and Deprecation Policy

This policy defines backward-compatibility guarantees and deprecation process
for `roomd` runtime/API contracts.

<!-- roomd-deprecation-policy:json:start -->
{
  "compatibilityWindowMonths": 6,
  "legacySse": {
    "status": "deprecated",
    "deprecationNoticeDate": "2026-02-28",
    "sunsetNotBeforeDate": "2026-12-31",
    "removalCriteria": [
      "streamable-http parity maintained for all required roomd paths",
      "published migration guidance available",
      "at least one release cycle with explicit warning in docs/changelog"
    ]
  },
  "errorContract": {
    "shape": ["ok", "error", "code", "details?", "hint?"],
    "stability": "additive-only within v1"
  },
  "lifecycleRouteCompatibility": {
    "status": "removed",
    "deprecationNoticeDate": "2026-03-08",
    "removalDate": "2026-03-08",
    "canonicalRoute": "/rooms/:roomId/instances/:instanceId/lifecycle",
    "compatibilityRoute": "/rooms/:roomId/instances/:instanceId/evidence",
    "sunsetNotBeforeDate": "2026-04-07",
    "trackingSignal": "lifecycle.compatibility_route_hit",
    "telemetryGate": {
      "windowDays": 30,
      "maxCompatibilityRequestsPerDay": 0
    }
  }
}
<!-- roomd-deprecation-policy:json:end -->

## Compatibility Guarantees

- v1 compatibility for the `roomd` HTTP surface is additive-only:
  - existing endpoints and error-code semantics are not removed in minor releases.
  - new fields may be added, but existing fields retain meaning.
- The stable error response contract remains:
  - `ok`, `error`, `code`, optional `details`, optional `hint`.

## Transport Deprecation Policy

### Legacy HTTP + SSE

- `legacy-sse` transport remains available for compatibility.
- `legacy-sse` is deprecated as of `2026-02-28`.
- `legacy-sse` removal will not occur before `2026-12-31`.

### Sunset Criteria

Before removal of `legacy-sse`, all of the following must be true:

1. Streamable HTTP path is production-ready for all supported roomd integrations.
2. Migration guidance is published in repository docs and release notes.
3. At least one release cycle includes explicit deprecation warnings.

## Lifecycle Route Deprecation Policy

- Canonical ingress route:
  `POST /rooms/:roomId/instances/:instanceId/lifecycle`
- Compatibility alias (removed):
  `POST /rooms/:roomId/instances/:instanceId/evidence`
- Lifecycle compatibility alias was deprecated as of `2026-03-08`.
- Lifecycle compatibility alias was removed on `2026-03-08` under issue `#43`
  after gate confirmation.

### Lifecycle Sunset Criteria

Criteria required before `/evidence` removal (now completed):

1. Compatibility telemetry signal `lifecycle.compatibility_route_hit` is at most
   `0` requests/day for `30` consecutive days.
2. First-party callers use `/lifecycle` as the default route.
3. Contract and integration suites pass with compatibility route removed.

## Deprecation Process

1. Publish deprecation notice with concrete date and migration guidance.
2. Keep behavior stable during the minimum compatibility window.
3. Remove only after sunset criteria are met and documented in release notes.
