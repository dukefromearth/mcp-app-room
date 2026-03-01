import { HttpError } from "../errors";
import { matchesHttpUrlPrefix } from "../http-url-prefix";
import { parseServerDescriptor } from "../server-target";

export interface ServerPolicy {
  serverAllowlist: string[];
  stdioCommandAllowlist: string[];
  allowRemoteHttpServers: boolean;
  remoteHttpOriginAllowlist: string[];
}

export function assertServerAllowed(serverUrl: string, policy: ServerPolicy): void {
  const descriptor = parseServerDescriptor(serverUrl);
  if (descriptor.kind === "http") {
    if (policy.serverAllowlist.length > 0) {
      if (!policy.serverAllowlist.some((prefix) => matchesHttpUrlPrefix(descriptor.url, prefix))) {
        throw new HttpError(
          403,
          "SERVER_NOT_ALLOWLISTED",
          `Server URL is not allowlisted: ${descriptor.url}`,
        );
      }
      return;
    }

    const parsed = new URL(descriptor.url);
    if (isLoopbackHost(parsed.hostname)) {
      return;
    }

    if (!policy.allowRemoteHttpServers) {
      throw new HttpError(
        403,
        "SERVER_NOT_ALLOWLISTED",
        `Remote HTTP server blocked by policy: ${descriptor.url}`,
        {
          hint: "Set ROOMD_ALLOW_REMOTE_HTTP_SERVERS=true and configure ROOMD_REMOTE_HTTP_ORIGIN_ALLOWLIST.",
        },
      );
    }
    if (policy.remoteHttpOriginAllowlist.length === 0) {
      throw new HttpError(
        403,
        "SERVER_NOT_ALLOWLISTED",
        `Remote HTTP server origin is not allowlisted: ${parsed.origin}`,
        {
          hint: "Set ROOMD_REMOTE_HTTP_ORIGIN_ALLOWLIST to explicit allowed origins (comma-separated, or *).",
        },
      );
    }
    if (
      !policy.remoteHttpOriginAllowlist.includes("*") &&
      !policy.remoteHttpOriginAllowlist.includes(parsed.origin)
    ) {
      throw new HttpError(
        403,
        "SERVER_NOT_ALLOWLISTED",
        `Remote HTTP server origin is not allowlisted: ${parsed.origin}`,
        {
          details: {
            origin: parsed.origin,
            configuredOrigins: [...policy.remoteHttpOriginAllowlist],
          },
        },
      );
    }
    return;
  }

  if (policy.stdioCommandAllowlist.includes("*")) {
    return;
  }
  if (
    policy.stdioCommandAllowlist.length === 0 ||
    !policy.stdioCommandAllowlist.includes(descriptor.command)
  ) {
    throw new HttpError(
      403,
      "SERVER_NOT_ALLOWLISTED",
      `Stdio command is not allowlisted: ${descriptor.command}`,
      {
        hint: "Set ROOMD_STDIO_COMMAND_ALLOWLIST to allowed commands (comma-separated, or *).",
      },
    );
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}
