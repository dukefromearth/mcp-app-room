#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
} from "./global-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function usage() {
  console.error("Usage: node scripts/run-host.mjs <start|dev|serve>");
}

function parseArgs(args) {
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  const mode = args[0];
  if (mode !== "start" && mode !== "dev" && mode !== "serve") {
    usage();
    process.exit(1);
  }

  for (let i = 1; i < args.length; i++) {
    throw new Error(`Unknown argument for startup command: ${args[i]}`);
  }

  return {
    mode,
  };
}

async function assertPortAvailable(port, label) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();

    server.once("error", (error) => {
      server.close();
      rejectPromise(error);
    });

    server.once("listening", () => {
      server.close(() => resolvePromise(undefined));
    });

    server.listen(port);
  }).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
      throw new Error(
        `Configured ${label} port ${port} is already in use. Stop the conflicting process or update config/global.yaml host.ports.${label}.`,
      );
    }
    throw error;
  });
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}

const configPath = resolveGlobalConfigPath({
  repoRoot,
});

let config;
try {
  config = loadGlobalConfig(configPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  await assertPortAvailable(config.host.ports.host, "host");
  await assertPortAvailable(config.host.ports.sandbox, "sandbox");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(
  `[host] config=${configPath} roomd=${config.roomd.baseUrl} host=${config.host.ports.host} sandbox=${config.host.ports.sandbox} mode=${config.host.mode} room=${config.host.roomId} profile=${config.security.profile}`,
);

const env = {
  ...process.env,
  MCP_APP_ROOM_CONFIG: configPath,
};

const child = spawn(
  npmCommand,
  ["run", "--workspace", "apps/host-web", options.mode],
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
    `Failed to launch host (${options.mode}): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
