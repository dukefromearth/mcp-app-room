#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(process.cwd());

const supportMatrixPath = path.join(repoRoot, "docs/roomd-support-matrix.md");
const deprecationPolicyPath = path.join(
  repoRoot,
  "docs/roomd-deprecation-policy.md",
);
const releaseChecklistPath = path.join(
  repoRoot,
  "docs/roomd-release-readiness-checklist.md",
);
const lifecyclePlaybookPath = path.join(
  repoRoot,
  "docs/lifecycle-migration-playbook.md",
);

async function main() {
  const supportMatrix = await readText(supportMatrixPath);
  const deprecationPolicy = await readText(deprecationPolicyPath);
  const releaseChecklist = await readText(releaseChecklistPath);
  const lifecyclePlaybook = await readText(lifecyclePlaybookPath);

  assertContainsAll(supportMatrixPath, supportMatrix, [
    "## Core MCP Profile",
    "## MCP Apps Profile",
    "## Lifecycle Ingress Contract",
    "| `streamable-http` |",
    "| `legacy-sse` |",
    "| `stdio` |",
    "| `roots` |",
    "| `sampling` |",
    "| `elicitation` |",
    "POST /rooms/:roomId/instances/:instanceId/lifecycle",
  ]);

  assertContainsAll(deprecationPolicyPath, deprecationPolicy, [
    "## Compatibility Guarantees",
    "## Transport Deprecation Policy",
    "## Sunset Criteria",
    "## Lifecycle Route Deprecation Policy",
    "lifecycle.compatibility_route_hit",
    "2026-12-31",
    "legacy-sse",
  ]);

  assertContainsAll(releaseChecklistPath, releaseChecklist, [
    "## Release Readiness Checklist",
    "Tier 1 conformance artifact",
    "Support matrix updated",
    "Deprecation policy reviewed",
    "Lifecycle migration playbook reviewed",
    "Compatibility telemetry gate met",
  ]);

  assertContainsAll(lifecyclePlaybookPath, lifecyclePlaybook, [
    "## Canonical Contract",
    "## Route Migration: Before and After",
    "## Deprecation Gate for Compatibility Route",
    "POST /rooms/:roomId/instances/:instanceId/lifecycle",
    "POST /rooms/:roomId/instances/:instanceId/evidence",
    "lifecycle.compatibility_route_hit",
  ]);

  const supportSummary = parseJsonMarker(
    supportMatrixPath,
    supportMatrix,
    "roomd-support-matrix:json",
  );
  const deprecationSummary = parseJsonMarker(
    deprecationPolicyPath,
    deprecationPolicy,
    "roomd-deprecation-policy:json",
  );
  const checklistSummary = parseJsonMarker(
    releaseChecklistPath,
    releaseChecklist,
    "roomd-release-checklist:json",
  );
  const lifecycleSummary = parseJsonMarker(
    lifecyclePlaybookPath,
    lifecyclePlaybook,
    "lifecycle-migration-playbook:json",
  );

  assert(
    supportSummary.protocolSpecVersion === "2025-11-25",
    `${supportMatrixPath}: protocolSpecVersion must be 2025-11-25`,
  );
  assert(
    supportSummary.conformanceTier === "tier1",
    `${supportMatrixPath}: conformanceTier must be tier1`,
  );
  assert(
    Array.isArray(supportSummary.applicableRequiredScenarios) &&
      supportSummary.applicableRequiredScenarios.includes("initialize") &&
      supportSummary.applicableRequiredScenarios.includes("tools_call"),
    `${supportMatrixPath}: applicableRequiredScenarios must include initialize and tools_call`,
  );
  assert(
    supportSummary.transports?.["streamable-http"] === "supported" &&
      supportSummary.transports?.["legacy-sse"] === "supported-deprecated" &&
      supportSummary.transports?.stdio === "supported",
    `${supportMatrixPath}: transports summary must include streamable-http, legacy-sse, and stdio support states`,
  );
  assert(
    supportSummary.lifecycleIngress?.canonicalRoute === "/rooms/:roomId/instances/:instanceId/lifecycle" &&
      supportSummary.lifecycleIngress?.compatibilityRoute === "/rooms/:roomId/instances/:instanceId/evidence" &&
      supportSummary.lifecycleIngress?.compatibilityStatus === "supported-deprecated",
    `${supportMatrixPath}: lifecycleIngress must include canonical route, compatibility route, and deprecated status`,
  );

  assert(
    deprecationSummary.compatibilityWindowMonths >= 6,
    `${deprecationPolicyPath}: compatibilityWindowMonths must be >= 6`,
  );
  assert(
    deprecationSummary.legacySse?.status === "deprecated",
    `${deprecationPolicyPath}: legacySse.status must be deprecated`,
  );
  assert(
    deprecationSummary.legacySse?.sunsetNotBeforeDate === "2026-12-31",
    `${deprecationPolicyPath}: legacySse.sunsetNotBeforeDate must be 2026-12-31`,
  );
  assert(
    deprecationSummary.lifecycleRouteCompatibility?.status === "deprecated",
    `${deprecationPolicyPath}: lifecycleRouteCompatibility.status must be deprecated`,
  );
  assert(
    deprecationSummary.lifecycleRouteCompatibility?.canonicalRoute === "/rooms/:roomId/instances/:instanceId/lifecycle" &&
      deprecationSummary.lifecycleRouteCompatibility?.compatibilityRoute === "/rooms/:roomId/instances/:instanceId/evidence",
    `${deprecationPolicyPath}: lifecycleRouteCompatibility routes must match canonical and compatibility paths`,
  );
  assert(
    deprecationSummary.lifecycleRouteCompatibility?.sunsetNotBeforeDate === "2026-12-31",
    `${deprecationPolicyPath}: lifecycleRouteCompatibility.sunsetNotBeforeDate must be 2026-12-31`,
  );
  assert(
    deprecationSummary.lifecycleRouteCompatibility?.trackingSignal === "lifecycle.compatibility_route_hit",
    `${deprecationPolicyPath}: lifecycleRouteCompatibility.trackingSignal must be lifecycle.compatibility_route_hit`,
  );
  assert(
    deprecationSummary.lifecycleRouteCompatibility?.telemetryGate?.windowDays === 30 &&
      deprecationSummary.lifecycleRouteCompatibility?.telemetryGate?.maxCompatibilityRequestsPerDay === 0,
    `${deprecationPolicyPath}: lifecycleRouteCompatibility.telemetryGate must be 30 days and <= 0 compatibility requests/day`,
  );

  assert(
    checklistSummary.requiresConformanceThreshold === 1.0,
    `${releaseChecklistPath}: requiresConformanceThreshold must be 1.0`,
  );
  assert(
    checklistSummary.requiresConformanceArtifactPath === "artifacts/conformance",
    `${releaseChecklistPath}: requiresConformanceArtifactPath must be artifacts/conformance`,
  );
  assert(
    Array.isArray(checklistSummary.requiredPolicyDocs) &&
      checklistSummary.requiredPolicyDocs.includes("docs/roomd-support-matrix.md") &&
      checklistSummary.requiredPolicyDocs.includes("docs/roomd-deprecation-policy.md") &&
      checklistSummary.requiredPolicyDocs.includes("docs/lifecycle-migration-playbook.md"),
    `${releaseChecklistPath}: requiredPolicyDocs must include support matrix, deprecation policy, and lifecycle migration playbook`,
  );

  assert(
    lifecycleSummary.programIssue === 37 &&
      lifecycleSummary.documentationIssue === 42 &&
      lifecycleSummary.compatibilityRemovalIssue === 43,
    `${lifecyclePlaybookPath}: issue links must reference 37 (program), 42 (docs), and 43 (compatibility removal)`,
  );
  assert(
    lifecycleSummary.canonicalLifecycleRoute === "/rooms/:roomId/instances/:instanceId/lifecycle" &&
      lifecycleSummary.compatibilityLifecycleRoute === "/rooms/:roomId/instances/:instanceId/evidence",
    `${lifecyclePlaybookPath}: canonical and compatibility lifecycle routes must match policy`,
  );
  assert(
    lifecycleSummary.duplicateCreateContract?.firstCreateStatus === 201 &&
      lifecycleSummary.duplicateCreateContract?.duplicateCreateStatus === 200 &&
      lifecycleSummary.duplicateCreateContract?.duplicateCreatedFlag === false,
    `${lifecyclePlaybookPath}: duplicateCreateContract must encode 201/200 with duplicate created:false`,
  );
  assert(
    lifecycleSummary.compatibilityTelemetryGate?.trackingSignal === "lifecycle.compatibility_route_hit" &&
      lifecycleSummary.compatibilityTelemetryGate?.windowDays === 30 &&
      lifecycleSummary.compatibilityTelemetryGate?.maxCompatibilityRequestsPerDay === 0,
    `${lifecyclePlaybookPath}: compatibility telemetry gate must match lifecycle compatibility policy`,
  );
  assert(
    lifecycleSummary.compatibilityTelemetryGate?.trackingSignal ===
      deprecationSummary.lifecycleRouteCompatibility?.trackingSignal,
    `${lifecyclePlaybookPath}: telemetry signal must match deprecation policy`,
  );

  console.log("[docs-check] roomd governance docs are valid");
}

function parseJsonMarker(filePath, content, markerName) {
  const startToken = `<!-- ${markerName}:start -->`;
  const endToken = `<!-- ${markerName}:end -->`;
  const startIndex = content.indexOf(startToken);
  const endIndex = content.indexOf(endToken);

  assert(startIndex >= 0, `${filePath}: missing marker ${startToken}`);
  assert(endIndex > startIndex, `${filePath}: missing marker ${endToken}`);

  const jsonText = content
    .slice(startIndex + startToken.length, endIndex)
    .trim();

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: invalid JSON in ${markerName}: ${reason}`);
  }
}

function assertContainsAll(filePath, content, tokens) {
  for (const token of tokens) {
    assert(content.includes(token), `${filePath}: missing required token: ${token}`);
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${filePath}: unable to read file: ${reason}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error("[docs-check]", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
