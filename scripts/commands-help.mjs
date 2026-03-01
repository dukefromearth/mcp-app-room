#!/usr/bin/env node

const commands = [
  {
    name: "npm run dev",
    description: "Start host + roomd for local development.",
  },
  {
    name: "npm run verify:fast",
    description: "Fast pre-commit checks (repo guard, arch lint, docs, contract drift).",
  },
  {
    name: "npm run verify",
    description: "Main pre-push command (fast checks + build + tests).",
  },
  {
    name: "npm run verify:full",
    description: "Full gate (verify + e2e + conformance Tier 1).",
  },
  {
    name: "npm run roomd:cli -- --help",
    description: "Open roomctl help and usage.",
  },
];

console.log("Recommended commands");
for (const cmd of commands) {
  console.log(`- ${cmd.name}`);
  console.log(`  ${cmd.description}`);
}

console.log("\nAdvanced commands still exist for debugging and maintenance.");
console.log("Run `npm run` to list all scripts if needed.");
