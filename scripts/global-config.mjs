import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

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

function asInteger(value, path, fallback) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${path} must be an integer`);
}

function asStringArray(value, path, fallback) {
  if (!Array.isArray(value)) {
    if (fallback) {
      return fallback;
    }
    throw new Error(`${path} must be an array of strings`);
  }

  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length > 0) {
    return normalized;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error(`${path} must include at least one string`);
}

function toAbsolutePath(cwd, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return resolve(cwd, value.trim());
}

export function resolveGlobalConfigPath({
  repoRoot,
  cwd = process.cwd(),
  cliConfigPath,
  envConfigPath = process.env.MCP_APP_ROOM_CONFIG,
}) {
  return (
    toAbsolutePath(cwd, cliConfigPath)
    ?? toAbsolutePath(cwd, envConfigPath)
    ?? resolve(repoRoot, "config", "global.yaml")
  );
}

export function loadGlobalConfig(configPath) {
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
  const host = asObject(root.host, "host");
  const hostPorts = asObject(host.ports, "host.ports");
  const hostBrowser = asObject(host.browser ?? {}, "host.browser");
  const security = asObject(root.security, "security");

  const roomdBaseUrl = asNonEmptyString(roomd.baseUrl, "roomd.baseUrl");
  const roomdUrl = new URL(roomdBaseUrl);
  if (!roomdUrl.hostname) {
    throw new Error("roomd.baseUrl must include a hostname");
  }
  const roomdPort = roomdUrl.port.length > 0
    ? Number.parseInt(roomdUrl.port, 10)
    : 8090;
  if (!Number.isFinite(roomdPort) || roomdPort <= 0) {
    throw new Error("roomd.baseUrl must include a valid port");
  }

  const securityProfile = asNonEmptyString(security.profile, "security.profile");
  if (securityProfile !== "strict" && securityProfile !== "local-dev") {
    throw new Error("security.profile must be strict or local-dev");
  }

  return {
    configPath,
    roomd: {
      baseUrl: roomdBaseUrl,
      port: roomdPort,
    },
    host: {
      mode: asNonEmptyString(host.mode, "host.mode"),
      roomId: asNonEmptyString(host.roomId, "host.roomId"),
      ports: {
        host: asInteger(hostPorts.host, "host.ports.host"),
        sandbox: asInteger(hostPorts.sandbox, "host.ports.sandbox"),
      },
      browser: {
        remoteDebuggingPort: asInteger(
          hostBrowser.remoteDebuggingPort,
          "host.browser.remoteDebuggingPort",
          9222,
        ),
      },
      servers: asStringArray(host.servers, "host.servers", [
        "http://localhost:3001/mcp",
      ]),
    },
    security: {
      profile: securityProfile,
    },
  };
}
