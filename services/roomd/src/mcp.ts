import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  McpUiResourceMetaSchema,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpSession,
  McpSessionFactory,
  SessionToolInfo,
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

async function connectWithFallback(serverUrl: string): Promise<Client> {
  const url = new URL(serverUrl);

  try {
    const client = new Client(IMPLEMENTATION);
    await client.connect(new StreamableHTTPClientTransport(url));
    return client;
  } catch {
    const client = new Client(IMPLEMENTATION);
    await client.connect(new SSEClientTransport(url));
    return client;
  }
}

class RealMcpSession implements McpSession {
  private toolCache: Map<string, SessionToolInfo> = new Map();
  private resourceCache: Map<string, Resource> = new Map();

  constructor(private readonly client: Client) {}

  async listToolInfo(toolName: string): Promise<SessionToolInfo> {
    if (this.toolCache.has(toolName)) {
      return this.toolCache.get(toolName)!;
    }

    const list = await this.client.listTools();
    for (const tool of list.tools) {
      this.toolCache.set(tool.name, {
        tool,
        uiResourceUri: getToolUiResourceUri(tool),
      });
    }

    const info = this.toolCache.get(toolName);
    if (!info) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    return info;
  }

  async callTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name: toolName, arguments: input });
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
          const client = await connectWithFallback(serverUrl);
          return new RealMcpSession(client);
        })(),
      );
    }

    return this.sessions.get(key)!;
  }
}
