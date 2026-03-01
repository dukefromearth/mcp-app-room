import { HttpError } from "./errors";
import type { NegotiatedSession } from "./types";

export type ServerCapability = "tools" | "resources" | "prompts" | "completions" | "logging";

export function ensureServerCapability(
  session: NegotiatedSession,
  capability: ServerCapability,
  operation: string,
): void {
  if (hasServerCapability(session, capability)) {
    return;
  }

  throw new HttpError(
    400,
    "UNSUPPORTED_CAPABILITY",
    `Server does not support ${capability} required by ${operation}`,
    {
      details: {
        capability,
        operation,
      },
      hint: "Check /instances/:instanceId/capabilities before calling this endpoint.",
    },
  );
}

export function hasServerCapability(
  session: NegotiatedSession,
  capability: ServerCapability,
): boolean {
  const value = session.capabilities[capability];
  return value !== undefined && value !== null;
}

export function ensureServerCapabilityFeature(
  session: NegotiatedSession,
  capability: ServerCapability,
  feature: string,
  operation: string,
): void {
  if (hasServerCapabilityFeature(session, capability, feature)) {
    return;
  }

  throw new HttpError(
    400,
    "UNSUPPORTED_CAPABILITY",
    `Server does not support ${capability}.${feature} required by ${operation}`,
    {
      details: {
        capability,
        feature,
        operation,
      },
      hint: "Check /instances/:instanceId/capabilities before calling this endpoint.",
    },
  );
}

export function hasServerCapabilityFeature(
  session: NegotiatedSession,
  capability: ServerCapability,
  feature: string,
): boolean {
  const value = session.capabilities[capability];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as Record<string, unknown>)[feature] === true;
}
