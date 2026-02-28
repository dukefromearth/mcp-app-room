#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import fg from "fast-glob";

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function tryRun(cmd, args) {
  try {
    return run(cmd, args);
  } catch {
    return "not installed";
  }
}

const repoRoot = run("git", ["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);

const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
const workspacePatterns = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
const workspaceDirs = await fg(workspacePatterns, { onlyDirectories: true, dot: false });

const nestedNodeModules = [];
for (const workspaceDir of workspaceDirs.sort((a, b) => a.localeCompare(b))) {
  const localNodeModulesPath = path.join(repoRoot, workspaceDir, "node_modules");
  try {
    const stat = await fs.stat(localNodeModulesPath);
    if (stat.isDirectory()) {
      nestedNodeModules.push(`${workspaceDir}/node_modules`);
    }
  } catch {
    // expected in npm workspaces with hoisted installs
  }
}

console.log("Repository doctor report");
console.log(`- Root: ${repoRoot}`);
console.log(`- Node: ${tryRun("node", ["--version"])}`);
console.log(`- npm: ${tryRun("npm", ["--version"])}`);
console.log(`- Go: ${tryRun("go", ["version"])}`);
console.log(`- Workspaces: ${workspaceDirs.length}`);

for (const workspaceDir of workspaceDirs) {
  console.log(`  - ${workspaceDir}`);
}

console.log("\nWorkspace install model");
console.log(
  "- npm workspaces hoist shared dependencies to root node_modules by default."
);
console.log(
  "- Missing node_modules inside a workspace is normal unless nested installs are explicitly configured."
);

if (nestedNodeModules.length > 0) {
  console.log("\nDetected nested node_modules (local state):");
  for (const location of nestedNodeModules) {
    console.log(`- ${location}`);
  }
  console.log(
    "- This can appear from local tool caches; repo-guard only blocks tracked node_modules paths."
  );
} else {
  console.log("\nNo nested workspace node_modules detected (expected).\n");
}
