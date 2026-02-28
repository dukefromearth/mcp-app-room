# roomd Release Readiness Checklist

Use this checklist before shipping a `roomd` release that changes MCP behavior.

<!-- roomd-release-checklist:json:start -->
{
  "requiresConformanceThreshold": 1.0,
  "requiresConformanceArtifactPath": "artifacts/conformance",
  "requiredPolicyDocs": [
    "docs/roomd-support-matrix.md",
    "docs/roomd-deprecation-policy.md"
  ]
}
<!-- roomd-release-checklist:json:end -->

## Release Readiness Checklist

- [ ] Tier 1 conformance artifact captured from CI (`artifacts/conformance`).
- [ ] Tier 1 threshold verified at `100%` pass for applicable required scenarios.
- [ ] Support matrix updated and reviewed (`docs/roomd-support-matrix.md`).
- [ ] Deprecation policy reviewed for timeline correctness (`docs/roomd-deprecation-policy.md`).
- [ ] Conformance workflow and artifacts linked in release notes/changelog entry.
