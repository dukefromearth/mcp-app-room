#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  let configPath = "tools/arch/arch.config.json";
  const selected = {
    deps: false,
    types: false,
    callgraph: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      configPath = argv[i + 1] ?? configPath;
      i += 1;
      continue;
    }
    if (arg === "--deps") {
      selected.deps = true;
      continue;
    }
    if (arg === "--types") {
      selected.types = true;
      continue;
    }
    if (arg === "--callgraph") {
      selected.callgraph = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: npm run arch -- [--deps] [--types] [--callgraph] [--config <path>]\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const noneSelected = !selected.deps && !selected.types && !selected.callgraph;
  if (noneSelected) {
    return {
      configPath,
      deps: true,
      types: true,
      callgraph: true,
    };
  }

  const selectedCount = Number(selected.deps) + Number(selected.types) + Number(selected.callgraph);
  if (selectedCount > 1) {
    throw new Error("Select only one graph flag: --deps, --types, or --callgraph");
  }

  return { configPath, ...selected };
}

function readConfig(repoRoot, configPath) {
  const fullPath = path.resolve(repoRoot, configPath);
  const raw = JSON.parse(readFileSync(fullPath, "utf8"));
  return {
    roots: Array.isArray(raw.roots) && raw.roots.length > 0 ? raw.roots : ["src"],
    includeOnly: typeof raw.includeOnly === "string" ? raw.includeOnly : "^src",
    exclude: Array.isArray(raw.exclude)
      ? raw.exclude.filter((item) => typeof item === "string" && item.length > 0)
      : [],
    configPath: fullPath,
  };
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return (result.stdout ?? "").trim();
}

function buildDepsMermaid(repoRoot, config) {
  const excludeRegex = config.exclude.length > 0 ? config.exclude.join("|") : "^$";
  return runCommand(
    "npx",
    [
      "depcruise",
      "--no-config",
      "--include-only",
      config.includeOnly,
      "--exclude",
      excludeRegex,
      "--output-type",
      "mermaid",
      ...config.roots,
    ],
    repoRoot,
  );
}

function buildTypeAndCallMermaid(repoRoot, configPath, wantTypes, wantCallgraph) {
  const args = [
    "tools/arch/generate.mjs",
    "--stdout",
    "--config",
    configPath,
  ];
  if (wantTypes && !wantCallgraph) {
    args.push("--types-only");
  } else if (!wantTypes && wantCallgraph) {
    args.push("--callgraph-only");
  } else if (wantTypes && wantCallgraph) {
    args.push("--types", "--callgraph");
  }
  return runCommand("node", args, repoRoot);
}

function main() {
  const repoRoot = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(repoRoot, args.configPath);

  const outputParts = [];
  if (args.deps) {
    outputParts.push(`%% graph:deps\n${buildDepsMermaid(repoRoot, config)}`);
  }
  if (args.types || args.callgraph) {
    outputParts.push(
      buildTypeAndCallMermaid(repoRoot, config.configPath, args.types, args.callgraph),
    );
  }

  process.stdout.write(`${outputParts.filter(Boolean).join("\n")}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
