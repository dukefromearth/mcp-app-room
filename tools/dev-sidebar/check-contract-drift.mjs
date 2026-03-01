#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const CONTRACTS_PATH = resolve(ROOT, "apps/host-web/src/dev-sidebar/contracts.ts");
const ADR_PATH = resolve(
  ROOT,
  "docs/ADR/dev-sidebar-protocol-console-contracts-2026-02-28.md",
);

const contractsText = readFileSync(CONTRACTS_PATH, "utf8");
const adrText = readFileSync(ADR_PATH, "utf8");

function extractConstLiterals(source, constName) {
  const match = source.match(
    new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`),
  );
  if (!match) {
    throw new Error(`Missing const definition: ${constName}`);
  }
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((entry) => entry[1]);
}

function extractAdrEnum(name) {
  const enumsSection = adrText.match(/enums:\n([\s\S]*?)\nschemas:/);
  if (!enumsSection) {
    throw new Error("ADR is missing YAML enums section.");
  }
  const section = enumsSection[1];
  const block = section.match(new RegExp(`${name}:\\n((?:\\s+- .+\\n)+)`));
  if (!block) {
    throw new Error(`ADR enum missing: ${name}`);
  }
  return block[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function asSet(values) {
  return new Set(values);
}

function equalSets(left, right) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function assertSetEqual(label, expected, actual) {
  const expectedSet = asSet(expected);
  const actualSet = asSet(actual);
  if (equalSets(expectedSet, actualSet)) {
    return;
  }

  const missing = [...expectedSet].filter((value) => !actualSet.has(value));
  const extra = [...actualSet].filter((value) => !expectedSet.has(value));
  throw new Error(
    `${label} drift detected. missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
  );
}

function assertContains(label, value) {
  if (!adrText.includes(value)) {
    throw new Error(`${label} missing required value: ${value}`);
  }
}

function assertContractsContains(label, value) {
  if (!contractsText.includes(value)) {
    throw new Error(`${label} missing required value: ${value}`);
  }
}

const contractsTabs = extractConstLiterals(contractsText, "DEV_SIDEBAR_TAB_IDS");
const contractsOps = extractConstLiterals(contractsText, "OPERATION_IDS");

const adrTabs = extractAdrEnum("DevSidebarTabId");
const adrOps = extractAdrEnum("OperationId");

assertSetEqual("DevSidebarTabId", contractsTabs, adrTabs);
assertSetEqual("OperationId", contractsOps, adrOps);

assertContains("ADR touchpoints", "apps/host-web/src/dev-sidebar/contracts.ts");
assertContains("ADR touchpoints", "apps/host-web/src/dev-sidebar/default-config.ts");
assertContains(
  "ADR touchpoints",
  "services/roomd/src/server-instance-routes.ts",
);
assertContains("ADR wire envelope", "WireEnvelope");
assertContractsContains("Contracts wire envelope", "export type WireEnvelope");

console.log("[dev-sidebar-contract-check] contracts and ADR are in sync");
