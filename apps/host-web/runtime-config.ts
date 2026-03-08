import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export type SecurityProfile = "strict" | "local-dev";

export interface RuntimeConfig {
  configPath: string;
  hostPort: number;
  sandboxPort: number;
  servers: string[];
  roomdUrl: string;
  roomId: string;
  roomConfigId?: string;
  roomConfigNamespace?: string;
  hostMode: string;
  remoteDebuggingPort: number;
  securityProfile: SecurityProfile;
}

interface CliOverrides {
  configPath?: string;
  hostPort?: number;
  sandboxPort?: number;
  roomdUrl?: string;
  roomId?: string;
  roomConfigId?: string;
  roomConfigNamespace?: string;
  hostMode?: string;
  remoteDebuggingPort?: number;
  securityProfile?: SecurityProfile;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(
  value: unknown,
  path: string,
  fallback?: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${path} must be a non-empty string`);
}

function asInteger(
  value: unknown,
  path: string,
  fallback?: number,
): number {
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

function asStringArray(
  value: unknown,
  path: string,
  fallback?: string[],
): string[] {
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

function parseCliOverrides(argv: string[]): CliOverrides {
  const overrides: CliOverrides = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--config") {
      if (!next) {
        throw new Error("--config requires a value");
      }
      overrides.configPath = resolve(process.cwd(), next);
      i += 1;
      continue;
    }
    if (token === "--host-port") {
      overrides.hostPort = asInteger(next, "--host-port");
      i += 1;
      continue;
    }
    if (token === "--sandbox-port") {
      overrides.sandboxPort = asInteger(next, "--sandbox-port");
      i += 1;
      continue;
    }
    if (token === "--roomd-url") {
      overrides.roomdUrl = asNonEmptyString(next, "--roomd-url");
      i += 1;
      continue;
    }
    if (token === "--room-id") {
      overrides.roomId = asNonEmptyString(next, "--room-id");
      i += 1;
      continue;
    }
    if (token === "--mode") {
      overrides.hostMode = asNonEmptyString(next, "--mode");
      i += 1;
      continue;
    }
    if (token === "--room-config-id") {
      overrides.roomConfigId = asNonEmptyString(next, "--room-config-id");
      i += 1;
      continue;
    }
    if (token === "--room-config-namespace") {
      overrides.roomConfigNamespace = asNonEmptyString(
        next,
        "--room-config-namespace",
      );
      i += 1;
      continue;
    }
    if (token === "--browser-remote-debugging-port") {
      overrides.remoteDebuggingPort = asInteger(
        next,
        "--browser-remote-debugging-port",
      );
      i += 1;
      continue;
    }
    if (token === "--security-profile") {
      const profile = asNonEmptyString(next, "--security-profile");
      if (profile !== "strict" && profile !== "local-dev") {
        throw new Error("--security-profile must be strict or local-dev");
      }
      overrides.securityProfile = profile;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return overrides;
}

export function loadRuntimeConfig(argv: string[], moduleDir: string): RuntimeConfig {
  const overrides = parseCliOverrides(argv);
  const configPath = overrides.configPath
    ?? (process.env.MCP_APP_ROOM_CONFIG
      ? resolve(process.cwd(), process.env.MCP_APP_ROOM_CONFIG)
      : resolve(moduleDir, "..", "..", "config", "global.yaml"));

  if (!existsSync(configPath)) {
    throw new Error(`Global config not found at ${configPath}`);
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to parse ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const root = asObject(parsedYaml, "config");
  const roomd = asObject(root.roomd, "roomd");
  const host = asObject(root.host, "host");
  const hostPorts = asObject(host.ports, "host.ports");
  const hostBrowser = asObject(host.browser ?? {}, "host.browser");
  const security = asObject(root.security, "security");

  const roomdBaseUrl = overrides.roomdUrl
    ?? asNonEmptyString(roomd.baseUrl, "roomd.baseUrl");
  const roomConfigIdFromConfig =
    typeof host.roomConfigId === "string" && host.roomConfigId.trim().length > 0
      ? host.roomConfigId.trim()
      : undefined;
  const roomConfigNamespaceFromConfig =
    typeof host.roomConfigNamespace === "string"
    && host.roomConfigNamespace.trim().length > 0
      ? host.roomConfigNamespace.trim()
      : undefined;

  const securityProfile = overrides.securityProfile
    ?? asNonEmptyString(security.profile, "security.profile") as SecurityProfile;
  if (securityProfile !== "strict" && securityProfile !== "local-dev") {
    throw new Error("security.profile must be strict or local-dev");
  }

  return {
    configPath,
    hostPort: overrides.hostPort ?? asInteger(hostPorts.host, "host.ports.host"),
    sandboxPort:
      overrides.sandboxPort ?? asInteger(hostPorts.sandbox, "host.ports.sandbox"),
    servers: asStringArray(host.servers, "host.servers", [
      "http://localhost:3001/mcp",
    ]),
    roomdUrl: roomdBaseUrl,
    roomId: overrides.roomId ?? asNonEmptyString(host.roomId, "host.roomId"),
    ...(overrides.roomConfigId
      ? { roomConfigId: overrides.roomConfigId }
      : roomConfigIdFromConfig
        ? { roomConfigId: roomConfigIdFromConfig }
        : {}),
    ...(overrides.roomConfigNamespace
      ? { roomConfigNamespace: overrides.roomConfigNamespace }
      : roomConfigNamespaceFromConfig
        ? { roomConfigNamespace: roomConfigNamespaceFromConfig }
        : {}),
    hostMode: overrides.hostMode ?? asNonEmptyString(host.mode, "host.mode"),
    remoteDebuggingPort: overrides.remoteDebuggingPort
      ?? asInteger(
        hostBrowser.remoteDebuggingPort,
        "host.browser.remoteDebuggingPort",
        9222,
      ),
    securityProfile,
  };
}
