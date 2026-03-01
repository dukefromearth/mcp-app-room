#!/usr/bin/env npx tsx
/**
 * HTTP servers for the MCP UI example:
 * - Host server serves host HTML files (React and Vanilla examples)
 * - Sandbox server serves sandbox.html with CSP headers
 *
 * Running on separate ports ensures proper origin isolation for security.
 *
 * Security: CSP is set via HTTP headers based on ?csp= query param.
 * This ensures content cannot tamper with CSP (unlike meta tags).
 */

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SecurityProfile = "strict" | "local-dev";

interface RuntimeConfig {
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

function loadRuntimeConfig(argv: string[]): RuntimeConfig {
  const overrides = parseCliOverrides(argv);
  const configPath = overrides.configPath
    ?? (process.env.MCP_APP_ROOM_CONFIG
      ? resolve(process.cwd(), process.env.MCP_APP_ROOM_CONFIG)
      : resolve(__dirname, "..", "..", "config", "global.yaml"));

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

const DIRECTORY = join(__dirname, "dist");
const runtimeConfig = loadRuntimeConfig(process.argv.slice(2));
const HOST_PORT = runtimeConfig.hostPort;
const SANDBOX_PORT = runtimeConfig.sandboxPort;
const SERVERS = runtimeConfig.servers;
const ROOMD_URL = runtimeConfig.roomdUrl;
const ROOM_ID = runtimeConfig.roomId;
const ROOM_CONFIG_ID = runtimeConfig.roomConfigId;
const ROOM_CONFIG_NAMESPACE = runtimeConfig.roomConfigNamespace;
const HOST_MODE = runtimeConfig.hostMode;
const REMOTE_DEBUGGING_PORT = runtimeConfig.remoteDebuggingPort;

/**
 * CSP mode used by the sandbox server.
 *
 * - `strict`: spec-aligned restrictive defaults.
 * - `dangerouslyAllow`: broad, development-focused allowances for fast prototyping.
 */
type SandboxCspMode = "strict" | "dangerouslyAllow";

/**
 * Profile shape used as the single source of truth for CSP behavior.
 */
interface SandboxCspProfile {
  description: string;
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  mediaSrc: string[];
  connectSrc: {
    withoutMetadata: string[];
    withMetadata: string[];
  };
  frameSrc: {
    default: string[];
    withMetadata: string[];
  };
  baseUri: {
    default: string[];
    withMetadata: string[];
  };
  objectSrc: string[];
}

/**
 * CSP policy profiles.
 *
 * This object is the single source of truth for all mode-specific CSP decisions.
 */
const SANDBOX_CSP_PROFILES: Record<SandboxCspMode, SandboxCspProfile> = {
  strict: {
    description: "Spec-aligned restrictive defaults.",
    defaultSrc: ["'none'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'"],
    // Allow object-URL media playback while keeping script/style locked down.
    mediaSrc: ["'self'", "data:", "blob:"],
    connectSrc: {
      withoutMetadata: ["'none'"],
      withMetadata: ["'self'"],
    },
    frameSrc: {
      default: ["'none'"],
      withMetadata: [],
    },
    baseUri: {
      default: ["'self'"],
      withMetadata: [],
    },
    objectSrc: ["'none'"],
  },
  dangerouslyAllow: {
    description: "Development mode with broad source allowances.",
    defaultSrc: ["'self'", "'unsafe-inline'", "blob:", "data:"],
    scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "data:"],
    styleSrc: ["'self'", "'unsafe-inline'", "blob:", "data:"],
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'", "data:", "blob:"],
    mediaSrc: ["'self'", "data:", "blob:"],
    connectSrc: {
      withoutMetadata: ["'self'", "http:", "https:", "ws:", "wss:"],
      withMetadata: ["'self'", "http:", "https:", "ws:", "wss:"],
    },
    frameSrc: {
      default: ["'self'", "http:", "https:"],
      withMetadata: ["'self'", "http:", "https:"],
    },
    baseUri: {
      default: ["'self'"],
      withMetadata: ["'self'"],
    },
    objectSrc: ["'none'"],
  },
};

const SANDBOX_CSP_MODE: SandboxCspMode =
  runtimeConfig.securityProfile === "local-dev" ? "dangerouslyAllow" : "strict";

// ============ Host Server (port 8080) ============
const hostApp = express();
hostApp.use(cors());

// Exclude sandbox.html from host server
hostApp.use((req, res, next) => {
  if (req.path === "/sandbox.html") {
    res.status(404).send("Sandbox is served on a different port");
    return;
  }
  next();
});

hostApp.use(express.static(DIRECTORY));

// API endpoint to get configured server URLs
hostApp.get("/api/servers", (_req, res) => {
  res.json(SERVERS);
});

hostApp.get("/api/host-config", (_req, res) => {
  res.json({
    mode: HOST_MODE,
    roomdUrl: ROOMD_URL || undefined,
    roomId: ROOM_ID,
    roomConfigId: ROOM_CONFIG_ID,
    roomConfigNamespace: ROOM_CONFIG_NAMESPACE,
  });
});

hostApp.get("/", (_req, res) => {
  res.redirect("/index.html");
});

// ============ Sandbox Server (port 8081) ============
const sandboxApp = express();
sandboxApp.use(cors());

/**
 * Strict source-expression guard used for CSP domain arrays.
 *
 * Per the MCP Apps spec, `ui.csp.*Domains` fields are origin lists. This host
 * accepts HTTP(S)/WS(S) origins plus wildcard subdomains (`https://*.example.com`)
 * and rejects anything that could loosen CSP via directive injection.
 */
const SAFE_SOURCE_PATTERN = /^(https?|wss?):\/\/(\*\.)?[a-zA-Z0-9.-]+(?::\d+)?$/;
const UNSAFE_SOURCE_CHARS = /[;\r\n'" ]/;

/**
 * Validate and sanitize user-declared CSP origin sources.
 *
 * Hosts MUST build CSP from declared metadata and MUST NOT allow undeclared
 * domains. Invalid entries are discarded.
 *
 * @param sources - Raw origin list from MCP resource metadata.
 * @returns Sanitized unique source expressions.
 */
function sanitizeCspOrigins(sources?: string[]): string[] {
  if (!sources) {
    return [];
  }

  const unique = new Set<string>();
  for (const raw of sources) {
    if (typeof raw !== "string") {
      continue;
    }
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (UNSAFE_SOURCE_CHARS.test(value)) {
      continue;
    }
    if (!SAFE_SOURCE_PATTERN.test(value)) {
      continue;
    }
    unique.add(value);
  }

  return Array.from(unique);
}

/**
 * Build a single CSP directive line from a name and source list.
 *
 * @param name - Directive name.
 * @param sources - Source-expression list.
 * @returns Serialized directive.
 */
function directive(name: string, sources: string[]): string {
  return `${name} ${sources.join(" ")}`;
}

/**
 * Merge source-expression groups, preserving order while removing duplicates.
 *
 * @param groups - Source-expression lists to merge.
 * @returns Deduplicated source-expression list.
 */
function mergeSources(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const group of groups) {
    for (const source of group) {
      if (seen.has(source)) {
        continue;
      }
      seen.add(source);
      merged.push(source);
    }
  }
  return merged;
}

/**
 * Build a spec-conformant CSP header for sandboxed MCP App rendering.
 *
 * Spec requirements implemented here:
 * - Restrictive default when `ui.csp` metadata is omitted.
 * - Domain-based expansion only from declared `ui.csp` fields.
 * - No permissive defaults like `unsafe-eval`, `blob:`, or unrestricted network.
 *
 * @param csp - Optional CSP metadata from `resource._meta.ui.csp`.
 * @returns Serialized CSP header value.
 */
function buildCspHeader(csp?: McpUiResourceCsp): string {
  const profile = SANDBOX_CSP_PROFILES[SANDBOX_CSP_MODE];
  const resourceDomains = sanitizeCspOrigins(csp?.resourceDomains);
  const connectDomains = sanitizeCspOrigins(csp?.connectDomains);
  const frameDomains = sanitizeCspOrigins(csp?.frameDomains);
  const baseUriDomains = sanitizeCspOrigins(csp?.baseUriDomains);
  const hasDeclaredCspMetadata = !!csp;

  const connectBase = hasDeclaredCspMetadata
    ? profile.connectSrc.withMetadata
    : profile.connectSrc.withoutMetadata;
  const frameBase = frameDomains.length > 0
    ? profile.frameSrc.withMetadata
    : profile.frameSrc.default;
  const baseUriBase = baseUriDomains.length > 0
    ? profile.baseUri.withMetadata
    : profile.baseUri.default;

  const directives = [
    directive("default-src", profile.defaultSrc),
    directive("script-src", mergeSources(profile.scriptSrc, resourceDomains)),
    directive("style-src", mergeSources(profile.styleSrc, resourceDomains)),
    directive("img-src", mergeSources(profile.imgSrc, resourceDomains)),
    directive("font-src", mergeSources(profile.fontSrc, resourceDomains)),
    directive("media-src", mergeSources(profile.mediaSrc, resourceDomains)),
    directive("connect-src", mergeSources(connectBase, connectDomains)),
    directive("frame-src", mergeSources(frameBase, frameDomains)),
    directive("object-src", profile.objectSrc),
    directive("base-uri", mergeSources(baseUriBase, baseUriDomains)),
  ];

  return directives.join("; ");
}

// Serve sandbox.html with CSP from query params
sandboxApp.get(["/", "/sandbox.html"], (req, res) => {
  // Parse CSP config from query param: ?csp=<url-encoded-json>
  let cspConfig: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      cspConfig = JSON.parse(req.query.csp);
    } catch (e) {
      console.warn("[Sandbox] Invalid CSP query param:", e);
    }
  }

  // Set CSP via HTTP header - tamper-proof unlike meta tags
  const cspHeader = buildCspHeader(cspConfig);
  const profile = SANDBOX_CSP_PROFILES[SANDBOX_CSP_MODE];
  console.info(
    "[Sandbox] Applying CSP",
    `mode=${SANDBOX_CSP_MODE}`,
    cspConfig ? "(from ui.csp metadata)" : "(from profile default)",
    `profile=${profile.description}`,
    cspHeader,
  );
  res.setHeader("X-MCP-Sandbox-CSP-Mode", SANDBOX_CSP_MODE);
  res.setHeader("Content-Security-Policy", cspHeader);

  // Prevent caching to ensure fresh CSP on each load
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.sendFile(join(DIRECTORY, "sandbox.html"));
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ============ Start both servers ============
hostApp.listen(HOST_PORT, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(
    `[Config] ${runtimeConfig.configPath} profile=${runtimeConfig.securityProfile} roomd=${ROOMD_URL}`,
  );
  console.log(`Host server:    http://localhost:${HOST_PORT}`);
});

sandboxApp.listen(SANDBOX_PORT, (err) => {
  if (err) {
    console.error("Error starting server:", err);
    process.exit(1);
  }
  console.log(`Sandbox server: http://localhost:${SANDBOX_PORT}`);
  console.log(
    `[Sandbox] CSP mode: ${SANDBOX_CSP_MODE} (${SANDBOX_CSP_PROFILES[SANDBOX_CSP_MODE].description})`,
  );
  if (SANDBOX_CSP_MODE === "dangerouslyAllow") {
    console.warn(
      "[Sandbox] WARNING: dangerouslyAllow mode is non-spec and should only be used for local prototyping.",
    );
  }
  maybeLaunchBrowser();
  console.log("\nPress Ctrl+C to stop\n");
});

function shouldLaunchBrowser(): boolean {
  if (process.env.AUTO_LAUNCH_BROWSER === "false") return false;
  if (process.env.CI === "true") return false;
  if (process.env.PLAYWRIGHT_TEST === "1") return false;
  return true;
}

function getLaunchUrl(): string {
  const url = new URL(`http://localhost:${HOST_PORT}/`);
  url.searchParams.set("mode", HOST_MODE);

  if (HOST_MODE === "room" && ROOMD_URL) {
    url.searchParams.set("roomd", ROOMD_URL);
    url.searchParams.set("room", ROOM_ID);
  }

  return url.toString();
}

function maybeLaunchBrowser(): void {
  if (!shouldLaunchBrowser()) {
    return;
  }

  const launchUrl = getLaunchUrl();
  const chromeCommand = detectChromeCommand();

  if (!chromeCommand) {
    console.warn(
      "[Host] Could not find Chrome/Chromium to auto-launch with remote debugging.",
    );
    console.warn(`[Host] Open manually: ${launchUrl}`);
    return;
  }

  const userDataDir = join(
    homedir(),
    ".cache",
    "mcp-app-room-chrome-profile",
  );
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--new-window",
    launchUrl,
  ];

  const child = spawn(chromeCommand, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(
    `[Host] Launched browser with remote debugging on :${REMOTE_DEBUGGING_PORT}`,
  );
  console.log(`[Host] URL: ${launchUrl}`);
}

function detectChromeCommand(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  const linuxCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return linuxCandidates.find((candidate) => existsSync(candidate));
}
