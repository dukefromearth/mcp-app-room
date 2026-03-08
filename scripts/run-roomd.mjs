#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGlobalConfig,
  resolveBootstrapRooms,
  resolveGlobalConfigPath,
} from "./global-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function usage() {
  console.error(
    "Usage: node scripts/run-roomd.mjs <start|dev> [--config <path>] [--profile <strict|local-dev>]",
  );
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
      const value = args[i + 1];
      if (!value) {
        throw new Error("--config requires a value");
      }
      configPath = value;
      i += 1;
      continue;
    }
    if (token === "--profile") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--profile requires a value");
      }
      profileOverride = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    mode,
    configPath,
    profileOverride,
  };
}

async function assertPortAvailable(port) {
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
        `Configured roomd port ${port} is already in use. Stop the conflicting process or update roomd.baseUrl in config/global.yaml.`,
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
  cliConfigPath: options.configPath,
});

let config;
try {
  config = loadGlobalConfig(configPath);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  await assertPortAvailable(config.roomd.port);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const profile = options.profileOverride ?? config.security.profile;
if (profile !== "strict" && profile !== "local-dev") {
  console.error("profile override must be strict or local-dev");
  process.exit(1);
}

const bootstrapRooms = resolveBootstrapRooms(config);

const env = {
  ...process.env,
  MCP_APP_ROOM_CONFIG: configPath,
  ROOMD_PORT: String(config.roomd.port),
  // GOTCHA: browsers can reconnect to the previous room EventSource before the
  // host process has time to recreate the default room during `npm run dev`.
  ROOMD_BOOTSTRAP_ROOMS: bootstrapRooms.join(","),
  DANGEROUSLY_ALLOW_STDIO: profile === "local-dev" ? "true" : "false",
  DANGEROUSLY_ALLOW_REMOTE_HTTP: profile === "local-dev" ? "true" : "false",
};

console.log(
  `[roomd] config=${configPath} baseUrl=${config.roomd.baseUrl} profile=${profile} bootstrapRooms=${bootstrapRooms.join(",") || "(none)"}`,
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
