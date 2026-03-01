#!/usr/bin/env node

const commands = [
  {
    name: "npm run dev",
    description: "Start host + roomd using config/global.yaml (or MCP_APP_ROOM_CONFIG).",
  },
  {
    name: "npm run host:open",
    description: "Open browser URL derived from global config.",
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
  {
    name: "npm run fixture:integration-server",
    description: "Run canonical real MCP fixture used by integration tests.",
  },
];

console.log("Recommended commands");
for (const cmd of commands) {
  console.log(`- ${cmd.name}`);
  console.log(`  ${cmd.description}`);
}

console.log("\nAdvanced commands still exist for debugging and maintenance.");
console.log("Run `npm run` to list all scripts if needed.");
