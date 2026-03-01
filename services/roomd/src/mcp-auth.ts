import { RoomdAuthError } from "./errors";
import type { HttpAuthStrategyConfig } from "./types";
import { matchesHttpUrlPrefix } from "./http-url-prefix";

export function resolveHttpAuthStrategy(
  serverUrl: string,
  config: Record<string, HttpAuthStrategyConfig>,
): HttpAuthStrategyConfig {
  let matchPrefix = "";
  let match: HttpAuthStrategyConfig | undefined;

  for (const [prefix, strategy] of Object.entries(config)) {
    if (!matchesHttpUrlPrefix(serverUrl, prefix)) {
      continue;
    }

    if (prefix.length > matchPrefix.length) {
      matchPrefix = prefix;
      match = strategy;
    }
  }

  return match ?? { type: "none" };
}

export function buildAuthHeaders(
  strategy: HttpAuthStrategyConfig,
  serverUrl: string,
): Record<string, string> {
  if (strategy.type === "none") {
    return {};
  }

  if (strategy.type === "oauth") {
    // GOTCHA: OAuth interactive/discovery flows are intentionally deferred; this
    // placeholder keeps the strategy boundary stable for a later adapter.
    throw new RoomdAuthError(
      501,
      "AUTH_DISCOVERY_FAILED",
      `OAuth auth strategy is not implemented for ${serverUrl}`,
      {
        details: {
          server: serverUrl,
          issuer: strategy.issuer,
          audience: strategy.audience,
        },
      },
    );
  }

  const token = strategy.token.trim();
  if (token.length === 0) {
    throw new RoomdAuthError(
      401,
      "AUTH_REQUIRED",
      `Bearer token is missing for ${serverUrl}`,
      {
        details: {
          server: serverUrl,
        },
      },
    );
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export function isUnauthorizedTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown };

  if (candidate.code === 401 || candidate.code === 403) {
    return true;
  }

  const message =
    typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return (
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("401") ||
    message.includes("403")
  );
}
