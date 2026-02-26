import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
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

    const contentMeta = (content as { _meta?: { ui?: unknown } })._meta;
    const listingMeta = await this.readResourceListingMeta(uri);
    const uiMeta =
      (contentMeta?.ui as
        | { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions }
        | undefined) ?? listingMeta;

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
  ): Promise<{ csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } | undefined> {
    if (!this.resourceCache.has(uri)) {
      const listing = await this.client.listResources();
      for (const resource of listing.resources) {
        this.resourceCache.set(resource.uri, resource);
      }
    }

    const listingResource = this.resourceCache.get(uri);
    const uiMeta = (listingResource as { _meta?: { ui?: unknown } } | undefined)?._meta
      ?.ui as { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } | undefined;

    return uiMeta;
  }
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
