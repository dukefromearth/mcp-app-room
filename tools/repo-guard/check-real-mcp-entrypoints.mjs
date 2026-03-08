#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const failures = [];

function readText(relPath) {
  const absolutePath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`missing required file: ${relPath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function assertContains(relPath, pattern, description) {
  const content = readText(relPath);
  if (!content.includes(pattern)) {
    failures.push(`${relPath}: missing ${description} (${pattern})`);
  }
}

const pkgRaw = readText("package.json");
if (pkgRaw.length > 0) {
  try {
    const pkg = JSON.parse(pkgRaw);
    const scripts = pkg?.scripts ?? {};
    if (scripts["test:integration:real-mcp"] !== "playwright test e2e/playwright/roomctl-await-real-server.e2e.spec.ts") {
      failures.push(
        "package.json: scripts.test:integration:real-mcp must point to canonical real-MCP integration suite",
      );
    }
  } catch (error) {
    failures.push(`package.json: failed to parse JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

assertContains(
  ".github/workflows/pr-required-gates.yml",
  "npm run test:integration:real-mcp",
  "required real-MCP test gate command",
);
assertContains(
  "docs/repository-setup.md",
  "test:integration:real-mcp",
  "documented real-MCP integration command",
);
assertContains(
  "docs/README.md",
  "test:integration:real-mcp",
  "docs index reference to real-MCP gate",
);

if (failures.length > 0) {
  console.error("real-mcp-entrypoints: failed checks");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("real-mcp-entrypoints: ok");
