#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadGlobalConfig,
  resolveGlobalConfigPath,
} from "./global-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

function usage() {
  console.error(
    "Usage: node scripts/open-room.mjs [--config <path>] [--room <room-id>] [--print]",
  );
}

function parseArgs(args) {
  let configPath;
  let roomIdOverride;
  let printOnly = false;

  for (let i = 0; i < args.length; i++) {
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
    if (token === "--room") {
      const value = args[i + 1];
      if (!value) {
        throw new Error("--room requires a value");
      }
      roomIdOverride = value;
      i += 1;
      continue;
    }
    if (token === "--print") {
      printOnly = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    configPath,
    roomIdOverride,
    printOnly,
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

const roomId = options.roomIdOverride ?? config.host.roomId;
const url = new URL(`http://localhost:${config.host.ports.host}/`);
// Keep the launch URL explicit and deterministic even if host default mode changes.
url.searchParams.set("debug", "1");
url.searchParams.set("mode", config.host.mode);
url.searchParams.set("roomd", config.roomd.baseUrl);
url.searchParams.set("room", roomId);

console.log(`[host] open ${url.toString()} (config=${configPath})`);

if (options.printOnly) {
  process.exit(0);
}

const platform = process.platform;
let command;
let args;
if (platform === "darwin") {
  command = "open";
  args = [url.toString()];
} else if (platform === "win32") {
  command = "cmd";
  args = ["/c", "start", "", url.toString()];
} else {
  command = "xdg-open";
  args = [url.toString()];
}

const result = spawnSync(command, args, { stdio: "inherit" });
if (result.error) {
  console.error(
    `Failed to open browser with ${command}: ${
      result.error instanceof Error ? result.error.message : String(result.error)
    }`,
  );
  process.exit(1);
}

process.exit(result.status ?? 0);
