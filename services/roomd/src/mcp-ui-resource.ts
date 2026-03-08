import { getRoomdLogger } from "./logging";

export interface ResourceMetaContainer {
  _meta?: { ui?: unknown };
  meta?: { ui?: unknown };
}

export type UiResourceMeta = {
  csp?: unknown;
  permissions?: unknown;
};

interface UiMetaSafeParseResult {
  success: boolean;
  data?: UiResourceMeta;
  errorMessage?: string;
}

const logger = getRoomdLogger({ component: "mcp_ui_resource" });

/**
 * Read `ui` metadata from MCP resource metadata containers.
 *
 * Supports both `_meta` (spec-compliant) and `meta` (legacy Python SDK quirk).
 */
export function readUiResourceMetaCandidate(
  resource: ResourceMetaContainer | undefined,
): unknown {
  return resource?._meta?.ui ?? resource?.meta?.ui;
}

/**
 * Parse UI resource metadata using ext-apps schemas.
 *
 * Invalid metadata is ignored so session behavior remains stable even when a
 * server sends malformed optional metadata.
 */
export function parseUiResourceMeta(
  rawMeta: unknown,
  level: "content-level" | "listing-level",
  safeParse: (value: unknown) => UiMetaSafeParseResult,
): UiResourceMeta | undefined {
  if (rawMeta === undefined) {
    return undefined;
  }

  const parsed = safeParse(rawMeta);
  if (!parsed.success) {
    logger.warn("parseUiResourceMeta.invalid", {
      level,
      errorMessage: parsed.errorMessage ?? "invalid",
    });
    return undefined;
  }

  return parsed.data;
}
