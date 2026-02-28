import {
  RESOURCE_MIME_TYPE,
  McpUiResourceMetaSchema,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type {
  CompletionCompleteParams,
  McpSession,
  McpSessionFactory,
  NegotiatedSession,
  PromptGetParams,
  ResourceSubscriptionParams,
  SessionTransportKind,
  ToolUiResource,
} from "./types";

const IMPLEMENTATION = { name: "roomd", version: "0.1.0" };

interface ResourceMetaContainer {
  _meta?: { ui?: unknown };
  meta?: { ui?: unknown };
}

type UiResourceMeta = {
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
};

interface ConnectedClient {
  client: Client;
  transport: SessionTransportKind;
  protocolVersion?: string;
}

async function connectWithFallback(serverUrl: string): Promise<ConnectedClient> {
  const url = new URL(serverUrl);

  try {
    const transport = new StreamableHTTPClientTransport(url);
    const client = new Client(IMPLEMENTATION);
    await client.connect(transport);
    return {
      client,
      transport: "streamable-http",
      protocolVersion: readProtocolVersion(transport),
    };
  } catch {
    const transport = new SSEClientTransport(url);
    const client = new Client(IMPLEMENTATION);
    await client.connect(transport);
    return {
      client,
      transport: "legacy-sse",
      protocolVersion: readProtocolVersion(transport),
    };
  }
}

class RealMcpSession implements McpSession {
  private resourceCache: Map<string, Resource> = new Map();

  constructor(
    private readonly client: Client,
    private readonly negotiatedSession: NegotiatedSession,
  ) {}

  getNegotiatedSession(): NegotiatedSession {
    return {
      ...this.negotiatedSession,
      capabilities: { ...this.negotiatedSession.capabilities },
      extensions: { ...this.negotiatedSession.extensions },
    };
  }

  async callTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name: toolName, arguments: input });
  }

  async getPrompt(params: PromptGetParams): Promise<unknown> {
    return this.client.getPrompt(params);
  }

  async complete(params: CompletionCompleteParams): Promise<unknown> {
    return this.client.complete(params);
  }

  async subscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    return this.client.subscribeResource(params);
  }

  async unsubscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    return this.client.unsubscribeResource(params);
  }

  async listTools(params?: { cursor?: string }): Promise<unknown> {
    return this.client.listTools(params);
  }

  async readUiResource(uri: string): Promise<ToolUiResource> {
    const resource = await this.client.readResource({ uri });

    if (!resource || resource.contents.length !== 1) {
      throw new Error(`Unexpected resource response for uri ${uri}`);
    }

    const content = resource.contents[0];
    if (content.mimeType !== RESOURCE_MIME_TYPE) {
      throw new Error(`Unsupported UI resource MIME type: ${content.mimeType}`);
    }

    const html =
      "blob" in content
        ? Buffer.from(content.blob, "base64").toString("utf8")
        : content.text;

    const contentMeta = parseUiResourceMeta(
      readUiResourceMetaCandidate(content as ResourceMetaContainer),
      "content-level"
    );
    const listingMeta = await this.readResourceListingMeta(uri);
    const uiMeta = contentMeta ?? listingMeta;

    return {
      uiResourceUri: uri,
      html,
      csp: uiMeta?.csp,
      permissions: uiMeta?.permissions,
    };
  }

  async listResources(params?: { cursor?: string }): Promise<unknown> {
    return this.client.listResources(params);
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    return this.client.readResource(params);
  }

  async listResourceTemplates(params?: { cursor?: string }): Promise<unknown> {
    return this.client.listResourceTemplates(params);
  }

  async listPrompts(params?: { cursor?: string }): Promise<unknown> {
    return this.client.listPrompts(params);
  }

  getServerCapabilities(): unknown {
    return this.client.getServerCapabilities() ?? {};
  }

  private async readResourceListingMeta(
    uri: string,
  ): Promise<UiResourceMeta | undefined> {
    if (!this.resourceCache.has(uri)) {
      const listing = await this.client.listResources();
      for (const resource of listing.resources) {
        this.resourceCache.set(resource.uri, resource);
      }
    }

    const listingResource = this.resourceCache.get(uri) as ResourceMetaContainer | undefined;
    return parseUiResourceMeta(
      readUiResourceMetaCandidate(listingResource),
      "listing-level"
    );
  }
}

/**
 * Read `ui` metadata from MCP resource metadata containers.
 *
 * Supports both `_meta` (spec-compliant) and `meta` (legacy Python SDK quirk).
 */
function readUiResourceMetaCandidate(resource: ResourceMetaContainer | undefined): unknown {
  return resource?._meta?.ui ?? resource?.meta?.ui;
}

/**
 * Parse UI resource metadata using ext-apps schemas.
 *
 * Invalid metadata is ignored so session behavior remains stable even when a
 * server sends malformed optional metadata.
 */
function parseUiResourceMeta(rawMeta: unknown, level: "content-level" | "listing-level"): UiResourceMeta | undefined {
  if (rawMeta === undefined) {
    return undefined;
  }

  const parsed = McpUiResourceMetaSchema.safeParse(rawMeta);
  if (!parsed.success) {
    console.warn(`[roomd] Ignoring invalid ${level} UI metadata:`, parsed.error.message);
    return undefined;
  }

  return parsed.data;
}

export class RealMcpSessionFactory implements McpSessionFactory {
  private readonly sessions: Map<string, Promise<McpSession>> = new Map();

  async getSession(roomId: string, serverUrl: string): Promise<McpSession> {
    const key = `${roomId}::${serverUrl}`;

    if (!this.sessions.has(key)) {
      this.sessions.set(
        key,
        (async () => {
          const connected = await connectWithFallback(serverUrl);
          return new RealMcpSession(
            connected.client,
            buildNegotiatedSession(
              connected.client,
              connected.transport,
              connected.protocolVersion,
            ),
          );
        })(),
      );
    }

    // TODO: If first connect fails, we cache a rejected promise and future retries
    // fail until process restart. Evict failed entries to allow recovery.
    return this.sessions.get(key)!;
  }
}

function buildNegotiatedSession(
  client: Client,
  transport: SessionTransportKind,
  protocolVersion: string | undefined,
): NegotiatedSession {
  const capabilities = asRecord(client.getServerCapabilities()) ?? {};
  const extensions = asRecord(capabilities.experimental) ?? {};
  return {
    protocolVersion,
    capabilities,
    extensions,
    transport,
  };
}

function readProtocolVersion(transport: object): string | undefined {
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
