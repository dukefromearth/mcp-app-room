#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function usage() {
  console.error(
    "Usage: node scripts/run-roomd.mjs <start|dev> [--config <path>] [--profile <strict|local-dev>]",
  );
}

function asObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value;
}

function asNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function parseArgs(args) {
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const mode = args[0];
  if (mode !== "start" && mode !== "dev") {
    usage();
    process.exit(1);
  }

  let configPath;
  let profileOverride;

  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === "--config") {
      configPath = args[i + 1];
      i += 1;
      continue;
    }
    if (token === "--profile") {
      profileOverride = args[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    mode,
    configPath: configPath
      ? resolve(process.cwd(), configPath)
      : resolve(repoRoot, "config", "global.yaml"),
    profileOverride,
  };
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Global config not found at ${configPath}`);
  }

  let parsed;
  try {
    parsed = parseYaml(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to parse ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const root = asObject(parsed, "config");
  const roomd = asObject(root.roomd, "roomd");
  const security = asObject(root.security, "security");

  const baseUrl = asNonEmptyString(roomd.baseUrl, "roomd.baseUrl");
  const profile = asNonEmptyString(security.profile, "security.profile");
  if (profile !== "strict" && profile !== "local-dev") {
    throw new Error("security.profile must be either strict or local-dev");
  }

  const url = new URL(baseUrl);
  if (!url.hostname) {
    throw new Error("roomd.baseUrl must include a hostname");
  }
  const port = url.port.length > 0 ? Number.parseInt(url.port, 10) : 8090;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("roomd.baseUrl must include a valid port");
  }

  return {
    baseUrl,
    port,
    profile,
  };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}

let config;
try {
  config = loadConfig(options.configPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const profile = options.profileOverride ?? config.profile;
if (profile !== "strict" && profile !== "local-dev") {
  console.error("profile override must be strict or local-dev");
  process.exit(1);
}

const env = {
  ...process.env,
  ROOMD_PORT: String(config.port),
  DANGEROUSLY_ALLOW_STDIO: profile === "local-dev" ? "true" : "false",
  DANGEROUSLY_ALLOW_REMOTE_HTTP: profile === "local-dev" ? "true" : "false",
};

console.log(
  `[roomd] config=${options.configPath} baseUrl=${config.baseUrl} profile=${profile}`,
);

const child = spawn(
  npmCommand,
  ["run", "--workspace", "services/roomd", options.mode],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(
    `Failed to launch roomd (${options.mode}): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
