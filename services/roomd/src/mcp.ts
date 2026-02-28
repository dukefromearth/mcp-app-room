import {
  RESOURCE_MIME_TYPE,
  McpUiResourceMetaSchema,
  type McpUiResourceCsp,
  type McpUiResourcePermissions,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import {
  normalizeServerTarget,
  parseServerDescriptor,
} from "./server-target";
import type {
  CompletionCompleteParams,
  McpSession,
  McpSessionFactory,
  NegotiatedSession,
  PromptGetParams,
  ResourceSubscriptionParams,
  ServerDescriptor,
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

interface TransportAdapter {
  readonly kind: SessionTransportKind;
  canHandle(server: ServerDescriptor): boolean;
  connect(server: ServerDescriptor): Promise<ConnectedClient>;
}

interface RealMcpSessionFactoryOptions {
  stdioCommandAllowlist?: string[];
}

class HttpTransportAdapter implements TransportAdapter {
  readonly kind: SessionTransportKind = "streamable-http";

  canHandle(server: ServerDescriptor): boolean {
    return server.kind === "http";
  }

  async connect(server: ServerDescriptor): Promise<ConnectedClient> {
    if (server.kind !== "http") {
      throw new Error("HTTP adapter only supports HTTP descriptors");
    }

    const url = new URL(server.url);
    const streamableError: unknown[] = [];

    try {
      const transport = new StreamableHTTPClientTransport(url);
      const client = new Client(IMPLEMENTATION);
      await client.connect(transport);
      return {
        client,
        transport: "streamable-http",
        protocolVersion: readProtocolVersion(transport),
      };
    } catch (error) {
      streamableError.push(error);
    }

    try {
      const transport = new SSEClientTransport(url);
      const client = new Client(IMPLEMENTATION);
      await client.connect(transport);
      return {
        client,
        transport: "legacy-sse",
        protocolVersion: readProtocolVersion(transport),
      };
    } catch (error) {
      streamableError.push(error);
    }

    const causes = streamableError
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new Error(
      `Unable to establish HTTP/SSE MCP transport for ${server.url}: ${causes}`,
    );
  }
}

class StdioTransportAdapter implements TransportAdapter {
  readonly kind: SessionTransportKind = "stdio";

  constructor(private readonly commandAllowlist: string[]) {}

  canHandle(server: ServerDescriptor): boolean {
    return server.kind === "stdio";
  }

  async connect(server: ServerDescriptor): Promise<ConnectedClient> {
    if (server.kind !== "stdio") {
      throw new Error("Stdio adapter only supports stdio descriptors");
    }

    this.assertCommandAllowed(server.command);

    const parameters: StdioServerParameters = {
      command: server.command,
      args: [...server.args],
      ...(server.cwd ? { cwd: server.cwd } : {}),
      ...(server.env ? { env: { ...server.env } } : {}),
    };

    const transport = new StdioClientTransport(parameters);
    const client = new Client(IMPLEMENTATION);
    await client.connect(transport);

    return {
      client,
      transport: "stdio",
      protocolVersion: readProtocolVersion(transport),
    };
  }

  private assertCommandAllowed(command: string): void {
    if (this.commandAllowlist.includes("*")) {
      return;
    }

    if (this.commandAllowlist.length === 0) {
      throw new Error(
        "stdio transport is disabled: set ROOMD_STDIO_COMMAND_ALLOWLIST to permit commands",
      );
    }

    if (this.commandAllowlist.includes(command)) {
      return;
    }

    throw new Error(
      `stdio command is not allowlisted: ${command} (ROOMD_STDIO_COMMAND_ALLOWLIST=${this.commandAllowlist.join(",")})`,
    );
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

  async close(): Promise<void> {
    // GOTCHA: stdio subprocess shutdown fallback (SIGTERM/SIGKILL) is delegated
    // to SDK transport close implementation; this must always run on release.
    await this.client.close();
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
      "content-level",
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
      "listing-level",
    );
  }
}

/**
 * Read `ui` metadata from MCP resource metadata containers.
 *
 * Supports both `_meta` (spec-compliant) and `meta` (legacy Python SDK quirk).
 */
function readUiResourceMetaCandidate(
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
function parseUiResourceMeta(
  rawMeta: unknown,
  level: "content-level" | "listing-level",
): UiResourceMeta | undefined {
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
  private readonly adapters: TransportAdapter[];

  constructor(options: RealMcpSessionFactoryOptions = {}) {
    this.adapters = [
      new StdioTransportAdapter(options.stdioCommandAllowlist ?? []),
      new HttpTransportAdapter(),
    ];
  }

  async getSession(roomId: string, serverUrl: string): Promise<McpSession> {
    const normalizedServer = normalizeServerTarget(serverUrl);
    const key = `${roomId}::${normalizedServer}`;

    if (!this.sessions.has(key)) {
      const sessionPromise = (async () => {
        const descriptor = parseServerDescriptor(normalizedServer);
        const adapter = this.adapters.find((candidate) =>
          candidate.canHandle(descriptor),
        );
        if (!adapter) {
          throw new Error(`No transport adapter available for server: ${normalizedServer}`);
        }

        const connected = await adapter.connect(descriptor);
        return new RealMcpSession(
          connected.client,
          buildNegotiatedSession(
            connected.client,
            connected.transport,
            connected.protocolVersion,
          ),
        );
      })();

      this.sessions.set(
        key,
        sessionPromise.catch((error) => {
          this.sessions.delete(key);
          throw error;
        }),
      );
    }

    return this.sessions.get(key)!;
  }

  async releaseSession(roomId: string, serverUrl: string): Promise<void> {
    let normalizedServer: string;
    try {
      normalizedServer = normalizeServerTarget(serverUrl);
    } catch {
      return;
    }

    const key = `${roomId}::${normalizedServer}`;
    const pending = this.sessions.get(key);
    if (!pending) {
      return;
    }

    this.sessions.delete(key);
    try {
      const session = await pending;
      await session.close();
    } catch {
      // Ignore close/retrieval failures during release path.
    }
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
