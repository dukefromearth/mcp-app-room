import { HttpError } from "../errors";
import type {
  ClientRoot,
  NegotiatedSession,
  RoomMountTool,
} from "../types";

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const RESOURCE_URI_META_KEY = "ui/resourceUri";

export interface ParsedToolsPage {
  tools: RoomMountTool[];
  nextCursor?: string;
}

export interface ParsedResourcesPage {
  resources: Array<{ uri: string; mimeType?: string }>;
  nextCursor?: string;
}

export function parseToolsPage(payload: unknown): ParsedToolsPage {
  const body = asRecord(payload);
  const rawTools = Array.isArray(body?.tools) ? body.tools : [];
  const tools: RoomMountTool[] = [];

  for (const rawTool of rawTools) {
    const tool = asRecord(rawTool);
    if (!tool) {
      continue;
    }
    const name = asNonEmptyString(tool?.name);
    if (!name) {
      continue;
    }

    const title = asNonEmptyString(tool?.title);
    const description = asNonEmptyString(tool?.description);
    const inputSchema =
      tool?.inputSchema === undefined
        ? { type: "object", properties: {} }
        : cloneUnknown(tool.inputSchema);
    const uiResourceUri = extractToolUiResourceUri(tool);
    const visibility = extractToolVisibility(tool);

    tools.push({
      name,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      inputSchema,
      visibility,
      ...(uiResourceUri ? { uiResourceUri } : {}),
    });
  }

  return {
    tools,
    nextCursor: asNonEmptyString(body?.nextCursor),
  };
}

export function parseResourcesPage(payload: unknown): ParsedResourcesPage {
  const body = asRecord(payload);
  const rawResources = Array.isArray(body?.resources) ? body.resources : [];
  const resources: Array<{ uri: string; mimeType?: string }> = [];

  for (const rawResource of rawResources) {
    const resource = asRecord(rawResource);
    const uri = asNonEmptyString(resource?.uri);
    if (!uri) {
      continue;
    }
    const mimeType = asNonEmptyString(resource?.mimeType);
    resources.push({ uri, ...(mimeType ? { mimeType } : {}) });
  }

  return {
    resources,
    nextCursor: asNonEmptyString(body?.nextCursor),
  };
}

export function isUiCandidateResource(resource: {
  uri: string;
  mimeType?: string;
}): boolean {
  return resource.uri.startsWith("ui://") || resource.mimeType === RESOURCE_MIME_TYPE;
}

export function buildExampleCommands(serverUrl: string, uiCandidates: string[]): string[] {
  const quotedServer = shellQuote(serverUrl);
  const baseMount = `roomctl mount --room <room-id> --instance <instance-id> --server ${quotedServer} --container 0,0,4,12`;
  const inspect = `roomctl inspect --server ${quotedServer}`;

  if (uiCandidates.length === 0) {
    return [baseMount, inspect];
  }
  if (uiCandidates.length === 1) {
    return [
      baseMount,
      `${baseMount} --ui-resource-uri ${shellQuote(uiCandidates[0])}`,
    ];
  }

  return [
    baseMount,
    inspect,
    ...uiCandidates.map((uri) => `${baseMount} --ui-resource-uri ${shellQuote(uri)}`),
  ];
}

export function cloneMountTool(tool: RoomMountTool): RoomMountTool {
  return {
    ...tool,
    ...(tool.visibility ? { visibility: [...tool.visibility] } : {}),
    inputSchema: cloneUnknown(tool.inputSchema),
  };
}

export function cloneNegotiatedSession(session: NegotiatedSession): NegotiatedSession {
  return {
    ...session,
    capabilities: cloneUnknown(session.capabilities),
    extensions: cloneUnknown(session.extensions),
    ...(session.clientCapabilities
      ? { clientCapabilities: cloneUnknown(session.clientCapabilities) }
      : {}),
  };
}

export function cloneUnknown<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export function assertFileRootUris(roots: ClientRoot[]): void {
  for (const root of roots) {
    if (isFileUri(root.uri)) {
      continue;
    }
    throw new HttpError(
      400,
      "INVALID_PAYLOAD",
      `Root URI must be a file:// URI: ${root.uri}`,
      {
        details: {
          uri: root.uri,
        },
      },
    );
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractToolUiResourceUri(tool: Record<string, unknown>): string | undefined {
  const meta = asRecord(tool._meta);
  const nestedUri = asNonEmptyString(asRecord(meta?.ui)?.resourceUri);
  if (nestedUri && nestedUri.startsWith("ui://")) {
    return nestedUri;
  }
  const flatUri = asNonEmptyString(meta?.[RESOURCE_URI_META_KEY]);
  if (flatUri && flatUri.startsWith("ui://")) {
    return flatUri;
  }
  if (nestedUri || flatUri) {
    // GOTCHA: malformed UI URI metadata must not crash inspection.
    return undefined;
  }
  return undefined;
}

function extractToolVisibility(tool: Record<string, unknown>): Array<"model" | "app"> {
  const meta = asRecord(tool._meta);
  const rawVisibility = asRecord(meta?.ui)?.visibility;
  return normalizeToolVisibility(rawVisibility);
}

function normalizeToolVisibility(
  rawVisibility: unknown,
): Array<"model" | "app"> {
  if (!Array.isArray(rawVisibility)) {
    return ["model", "app"];
  }

  const normalized = new Set<"model" | "app">();
  for (const value of rawVisibility) {
    if (value === "model" || value === "app") {
      normalized.add(value);
    }
  }

  if (normalized.size === 0) {
    // GOTCHA: invalid visibility metadata should degrade to default host behavior.
    return ["model", "app"];
  }
  return [...normalized];
}

function isFileUri(value: string): boolean {
  try {
    return new URL(value).protocol === "file:";
  } catch {
    return false;
  }
}
