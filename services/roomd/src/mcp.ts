import {
  RESOURCE_MIME_TYPE,
  McpUiResourceMetaSchema,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  StdioClientTransport,
  type StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { RoomdAuthError } from "./errors";
import {
  normalizeServerTarget,
  parseServerDescriptor,
} from "./server-target";
import type {
  HttpAuthStrategyConfig,
  McpSession,
  McpSessionFactory,
  ServerDescriptor,
  SessionTransportKind,
} from "./types";
import { ClientCapabilityRegistry } from "./client-capabilities/registry";
import {
  buildAuthHeaders,
  isUnauthorizedTransportError,
  resolveHttpAuthStrategy,
} from "./mcp-auth";
import { registerClientCapabilityHandlers } from "./mcp-client-capabilities";
import type { UiResourceMeta } from "./mcp-ui-resource";
import { buildNegotiatedSession, readProtocolVersion } from "./mcp-session-metadata";
import { RealMcpSession } from "./mcp-session";
import { getRoomdLogger, serializeError } from "./logging";

const IMPLEMENTATION = { name: "roomd", version: "0.1.0" };
const UI_EXTENSION_KEY = "io.modelcontextprotocol/ui";
const logger = getRoomdLogger({ component: "mcp_session_factory" });

interface ConnectedClient {
  client: Client;
  transport: SessionTransportKind;
  protocolVersion?: string;
  clientCapabilities?: Record<string, unknown>;
}

interface TransportAdapter {
  readonly kind: SessionTransportKind;
  canHandle(server: ServerDescriptor): boolean;
  connect(
    roomId: string,
    serverKey: string,
    server: ServerDescriptor,
  ): Promise<ConnectedClient>;
}

interface RealMcpSessionFactoryOptions {
  stdioCommandAllowlist?: string[];
  httpAuthConfig?: Record<string, HttpAuthStrategyConfig>;
  clientCapabilityRegistry?: ClientCapabilityRegistry;
}

class HttpTransportAdapter implements TransportAdapter {
  readonly kind: SessionTransportKind = "streamable-http";

  constructor(
    private readonly authConfig: Record<string, HttpAuthStrategyConfig>,
    private readonly capabilityRegistry?: ClientCapabilityRegistry,
  ) {}

  canHandle(server: ServerDescriptor): boolean {
    return server.kind === "http";
  }

  async connect(
    roomId: string,
    serverKey: string,
    server: ServerDescriptor,
  ): Promise<ConnectedClient> {
    const httpLogger = logger.child({
      adapter: "http",
      roomId,
      server: serverKey,
    });
    if (server.kind !== "http") {
      throw new Error("HTTP adapter only supports HTTP descriptors");
    }

    const url = new URL(server.url);
    const strategy = resolveHttpAuthStrategy(server.url, this.authConfig);
    const authHeaders = buildAuthHeaders(strategy, server.url);
    const requestInit =
      Object.keys(authHeaders).length > 0
        ? ({ headers: authHeaders } satisfies RequestInit)
        : undefined;

    const advertisedCapabilities = readAdvertisedCapabilities(
      this.capabilityRegistry,
      roomId,
      serverKey,
    );
    const streamableClient = createConfiguredClient(
      roomId,
      serverKey,
      advertisedCapabilities,
      this.capabilityRegistry,
    );

    const streamableErrors: unknown[] = [];

    try {
      const transport = new StreamableHTTPClientTransport(
        url,
        requestInit ? { requestInit } : undefined,
      );
      await streamableClient.connect(transport);
      const connected: ConnectedClient = {
        client: streamableClient,
        transport: "streamable-http",
        protocolVersion: readProtocolVersion(transport),
        clientCapabilities: advertisedCapabilities,
      };
      return connected;
    } catch (error) {
      httpLogger.debug("connect.streamable_http_failed", {
        error: serializeError(error),
      });
      streamableErrors.push(error);
    }

    try {
      const sseClient = createConfiguredClient(
        roomId,
        serverKey,
        advertisedCapabilities,
        this.capabilityRegistry,
      );
      const transport = new SSEClientTransport(
        url,
        requestInit ? { requestInit } : undefined,
      );
      await sseClient.connect(transport);
      const connected: ConnectedClient = {
        client: sseClient,
        transport: "legacy-sse",
        protocolVersion: readProtocolVersion(transport),
        clientCapabilities: advertisedCapabilities,
      };
      return connected;
    } catch (error) {
      httpLogger.debug("connect.sse_failed", {
        error: serializeError(error),
      });
      streamableErrors.push(error);
    }

    if (streamableErrors.some((error) => isUnauthorizedTransportError(error))) {
      if (strategy.type === "none") {
        httpLogger.warn("connect.auth_required", { server: server.url });
        throw new RoomdAuthError(
          401,
          "AUTH_REQUIRED",
          `Authentication required for ${server.url}`,
          {
            hint: "Configure ROOMD_HTTP_AUTH_CONFIG with a bearer token for this server.",
            details: { server: server.url, strategy: strategy.type },
          },
        );
      }

      httpLogger.warn("connect.auth_failed", {
        server: server.url,
        strategy: strategy.type,
      });
      throw new RoomdAuthError(
        401,
        "AUTH_FAILED",
        `Authentication failed for ${server.url}`,
        {
          details: {
            server: server.url,
            strategy: strategy.type,
          },
        },
      );
    }

    const causes = streamableErrors
      .map((error) => (error instanceof Error ? error.message : String(error)))
      .join("; ");
    throw new Error(
      `Unable to establish HTTP/SSE MCP transport for ${server.url}: ${causes}`,
    );
  }
}

class StdioTransportAdapter implements TransportAdapter {
  readonly kind: SessionTransportKind = "stdio";

  constructor(
    private readonly commandAllowlist: string[],
    private readonly capabilityRegistry?: ClientCapabilityRegistry,
  ) {}

  canHandle(server: ServerDescriptor): boolean {
    return server.kind === "stdio";
  }

  async connect(
    roomId: string,
    serverKey: string,
    server: ServerDescriptor,
  ): Promise<ConnectedClient> {
    const stdioLogger = logger.child({
      adapter: "stdio",
      roomId,
      server: serverKey,
    });
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
    const advertisedCapabilities = readAdvertisedCapabilities(
      this.capabilityRegistry,
      roomId,
      serverKey,
    );
    const client = createConfiguredClient(
      roomId,
      serverKey,
      advertisedCapabilities,
      this.capabilityRegistry,
    );

    await client.connect(transport);

    const connected: ConnectedClient = {
      client,
      transport: "stdio",
      protocolVersion: readProtocolVersion(transport),
      clientCapabilities: advertisedCapabilities,
    };
    stdioLogger.info("connect.exit", {
      transport: connected.transport,
      protocolVersion: connected.protocolVersion,
      command: server.command,
    });
    return connected;
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

export class RealMcpSessionFactory implements McpSessionFactory {
  private readonly sessions: Map<string, Promise<McpSession>> = new Map();
  private readonly adapters: TransportAdapter[];

  constructor(options: RealMcpSessionFactoryOptions = {}) {
    this.adapters = [
      new StdioTransportAdapter(
        options.stdioCommandAllowlist ?? [],
        options.clientCapabilityRegistry,
      ),
      new HttpTransportAdapter(
        options.httpAuthConfig ?? {},
        options.clientCapabilityRegistry,
      ),
    ];
  }

  async getSession(roomId: string, serverUrl: string): Promise<McpSession> {
    const normalizedServer = normalizeServerTarget(serverUrl);
    const key = `${roomId}::${normalizedServer}`;
    const sessionLogger = logger.child({
      roomId,
      server: normalizedServer,
      cacheKey: key,
    });
    sessionLogger.info("getSession.enter");

    if (!this.sessions.has(key)) {
      const sessionPromise = (async () => {
        const descriptor = parseServerDescriptor(normalizedServer);
        const adapter = this.adapters.find((candidate) =>
          candidate.canHandle(descriptor),
        );
        if (!adapter) {
          throw new Error(`No transport adapter available for server: ${normalizedServer}`);
        }

        const connected = await adapter.connect(roomId, normalizedServer, descriptor);
        return new RealMcpSession(
          connected.client,
          buildNegotiatedSession(
            connected.client,
            connected.transport,
            connected.protocolVersion,
            connected.clientCapabilities,
          ),
          {
            resourceMimeType: RESOURCE_MIME_TYPE,
            safeParseUiMeta,
          },
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

    const session = await this.sessions.get(key)!;
    sessionLogger.info("getSession.exit");
    return session;
  }

  async releaseSession(roomId: string, serverUrl: string): Promise<void> {
    const releaseLogger = logger.child({ roomId, serverUrl });
    releaseLogger.info("releaseSession.enter");
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
      releaseLogger.info("releaseSession.exit", { key });
    } catch {
      // Ignore close/retrieval failures during release path.
    }
  }
}

function readAdvertisedCapabilities(
  capabilityRegistry: ClientCapabilityRegistry | undefined,
  roomId: string,
  serverKey: string,
): Record<string, unknown> {
  const base =
    capabilityRegistry?.getAdvertisedClientCapabilities(roomId, serverKey) ?? {};
  const currentExtensions = asRecord(base.extensions) ?? {};
  return {
    ...base,
    extensions: {
      ...currentExtensions,
      [UI_EXTENSION_KEY]: {
        mimeTypes: [RESOURCE_MIME_TYPE],
      },
    },
  };
}

function createConfiguredClient(
  roomId: string,
  serverKey: string,
  advertisedCapabilities: Record<string, unknown>,
  capabilityRegistry: ClientCapabilityRegistry | undefined,
): Client {
  const client = new Client(IMPLEMENTATION, {
    capabilities: advertisedCapabilities,
  });

  registerClientCapabilityHandlers(
    client,
    {
      listRootsRequestSchema: ListRootsRequestSchema,
      createMessageRequestSchema: CreateMessageRequestSchema,
      elicitRequestSchema: ElicitRequestSchema,
    },
    advertisedCapabilities,
    roomId,
    serverKey,
    capabilityRegistry,
  );

  return client;
}

function safeParseUiMeta(rawMeta: unknown): {
  success: boolean;
  data?: UiResourceMeta;
  errorMessage?: string;
} {
  const parsed = McpUiResourceMetaSchema.safeParse(rawMeta);
  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
    };
  }
  return {
    success: false,
    errorMessage: parsed.error.message,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
