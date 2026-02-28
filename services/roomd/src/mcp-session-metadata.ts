import type { NegotiatedSession, SessionTransportKind } from "./types";

interface ServerCapabilityReader {
  getServerCapabilities(): unknown;
}

export function buildNegotiatedSession(
  client: ServerCapabilityReader,
  transport: SessionTransportKind,
  protocolVersion: string | undefined,
  clientCapabilities?: Record<string, unknown>,
): NegotiatedSession {
  const capabilities = asRecord(client.getServerCapabilities()) ?? {};
  const extensions = asRecord(capabilities.experimental) ?? {};
  return {
    protocolVersion,
    capabilities,
    extensions,
    transport,
    ...(clientCapabilities ? { clientCapabilities } : {}),
  };
}

export function readProtocolVersion(transport: object): string | undefined {
  const protocolVersion =
    asString((transport as { protocolVersion?: unknown }).protocolVersion) ??
    asString((transport as { _protocolVersion?: unknown })._protocolVersion);
  return protocolVersion;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
