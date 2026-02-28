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
