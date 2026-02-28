import type { ServerDescriptor, StdioServerDescriptor } from "./types";

const STDIO_SCHEME = "stdio:";
const STDIO_HOST = "spawn";
const STDIO_COMMAND_PARAM = "command";
const STDIO_ARG_PARAM = "arg";
const STDIO_CWD_PARAM = "cwd";
const STDIO_ENV_PREFIX = "env.";
const STDIO_ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class ServerTargetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerTargetParseError";
  }
}

export function isValidServerTarget(value: string): boolean {
  try {
    parseServerDescriptor(value);
    return true;
  } catch {
    return false;
  }
}

export function parseServerDescriptor(rawValue: string): ServerDescriptor {
  const value = rawValue.trim();
  if (value.length === 0) {
    throw new ServerTargetParseError("Server target must not be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ServerTargetParseError("Server target must be a valid URL or stdio descriptor");
  }

  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return {
      kind: "http",
      url: parsed.toString(),
    };
  }

  if (parsed.protocol !== STDIO_SCHEME) {
    throw new ServerTargetParseError(
      `Unsupported server target protocol: ${parsed.protocol}`,
    );
  }

  return parseStdioDescriptor(parsed);
}

export function normalizeServerTarget(rawValue: string): string {
  const descriptor = parseServerDescriptor(rawValue);
  if (descriptor.kind === "http") {
    return descriptor.url;
  }
  return formatStdioDescriptor(descriptor);
}

export function formatStdioDescriptor(descriptor: StdioServerDescriptor): string {
  const params = new URLSearchParams();
  params.set(STDIO_COMMAND_PARAM, descriptor.command);

  for (const arg of descriptor.args) {
    params.append(STDIO_ARG_PARAM, arg);
  }

  if (descriptor.cwd) {
    params.set(STDIO_CWD_PARAM, descriptor.cwd);
  }

  if (descriptor.env) {
    const keys = Object.keys(descriptor.env).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const key of keys) {
      params.set(`${STDIO_ENV_PREFIX}${key}`, descriptor.env[key]);
    }
  }

  return `stdio://${STDIO_HOST}?${params.toString()}`;
}

function parseStdioDescriptor(parsed: URL): StdioServerDescriptor {
  if (parsed.hostname !== "" && parsed.hostname !== STDIO_HOST) {
    throw new ServerTargetParseError(
      `Stdio descriptor host must be '${STDIO_HOST}' or empty`,
    );
  }

  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new ServerTargetParseError(
      "Stdio descriptor path is not supported; use query parameters only",
    );
  }

  const command = normalizeNonEmpty(
    parsed.searchParams.getAll(STDIO_COMMAND_PARAM),
    "Stdio descriptor requires a single command parameter",
  );

  const args = parsed.searchParams
    .getAll(STDIO_ARG_PARAM)
    .map((arg) => arg.trim())
    .filter((arg) => arg.length > 0);

  const cwdValues = parsed.searchParams.getAll(STDIO_CWD_PARAM);
  if (cwdValues.length > 1) {
    throw new ServerTargetParseError(
      "Stdio descriptor cwd must be specified at most once",
    );
  }
  const cwd = cwdValues.length === 1 ? cwdValues[0].trim() : undefined;

  const env: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams.entries()) {
    if (
      key === STDIO_COMMAND_PARAM ||
      key === STDIO_ARG_PARAM ||
      key === STDIO_CWD_PARAM
    ) {
      continue;
    }

    if (!key.startsWith(STDIO_ENV_PREFIX)) {
      throw new ServerTargetParseError(
        `Unsupported stdio descriptor parameter: ${key}`,
      );
    }

    const envKey = key.slice(STDIO_ENV_PREFIX.length);
    if (!STDIO_ENV_KEY_PATTERN.test(envKey)) {
      throw new ServerTargetParseError(
        `Invalid stdio environment variable key: ${envKey}`,
      );
    }

    env[envKey] = value;
  }

  return {
    kind: "stdio",
    command,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(cwd && cwd.length > 0 ? { cwd } : {}),
  };
}

function normalizeNonEmpty(values: string[], errorMessage: string): string {
  if (values.length !== 1) {
    throw new ServerTargetParseError(errorMessage);
  }
  const [value] = values;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ServerTargetParseError(errorMessage);
  }
  return trimmed;
}
