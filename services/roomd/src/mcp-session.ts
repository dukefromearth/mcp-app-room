import type {
  CompletionCompleteParams,
  McpSession,
  NegotiatedSession,
  PromptGetParams,
  ResourceSubscriptionParams,
  ToolUiResource,
} from "./types";
import {
  type ResourceMetaContainer,
  type UiResourceMeta,
  parseUiResourceMeta,
  readUiResourceMetaCandidate,
} from "./mcp-ui-resource";
import { getRoomdLogger, serializeError } from "./logging";

interface SessionClient {
  close(): Promise<void>;
  notification(payload: { method: string }): Promise<void>;
  callTool(payload: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  getPrompt(params: PromptGetParams): Promise<unknown>;
  complete(params: CompletionCompleteParams): Promise<unknown>;
  subscribeResource(params: ResourceSubscriptionParams): Promise<unknown>;
  unsubscribeResource(params: ResourceSubscriptionParams): Promise<unknown>;
  listTools(params?: { cursor?: string }): Promise<unknown>;
  readResource(params: { uri: string }): Promise<unknown>;
  listResources(params?: { cursor?: string }): Promise<unknown>;
  listResourceTemplates(params?: { cursor?: string }): Promise<unknown>;
  listPrompts(params?: { cursor?: string }): Promise<unknown>;
  getServerCapabilities(): unknown;
}

interface UiMetaParseResult {
  success: boolean;
  data?: UiResourceMeta;
  errorMessage?: string;
}

interface RealMcpSessionOptions {
  resourceMimeType: string;
  safeParseUiMeta: (rawMeta: unknown) => UiMetaParseResult;
}

export class RealMcpSession implements McpSession {
  private resourceCache: Map<string, unknown> = new Map();
  private readonly logger = getRoomdLogger({ component: "mcp_session" });

  constructor(
    private readonly client: SessionClient,
    private readonly negotiatedSession: NegotiatedSession,
    private readonly options: RealMcpSessionOptions,
  ) {}

  getNegotiatedSession(): NegotiatedSession {
    return {
      ...this.negotiatedSession,
      capabilities: { ...this.negotiatedSession.capabilities },
      extensions: { ...this.negotiatedSession.extensions },
      ...(this.negotiatedSession.clientCapabilities
        ? { clientCapabilities: { ...this.negotiatedSession.clientCapabilities } }
        : {}),
    };
  }

  async close(): Promise<void> {
    this.logger.info("close.enter");
    // GOTCHA: stdio subprocess shutdown fallback (SIGTERM/SIGKILL) is delegated
    // to SDK transport close implementation; this must always run on release.
    await this.client.close();
    this.logger.info("close.exit");
  }

  async notifyRootsListChanged(): Promise<void> {
    this.logger.info("notifyRootsListChanged.enter");
    await this.client.notification({
      method: "notifications/roots/list_changed",
    });
    this.logger.info("notifyRootsListChanged.exit");
  }

  async callTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    this.logger.info("callTool.enter", {
      toolName,
      argumentKeys: Object.keys(input),
    });
    try {
      const result = await this.client.callTool({ name: toolName, arguments: input });
      this.logger.info("callTool.exit", { toolName });
      return result;
    } catch (error) {
      this.logger.debug("callTool.error", {
        toolName,
        error: serializeError(error),
      });
      throw error;
    }
  }

  async getPrompt(params: PromptGetParams): Promise<unknown> {
    this.logger.info("getPrompt.enter", {
      name: params.name,
      hasArguments: !!params.arguments && Object.keys(params.arguments).length > 0,
    });
    const result = await this.client.getPrompt(params);
    this.logger.info("getPrompt.exit", { name: params.name });
    return result;
  }

  async complete(params: CompletionCompleteParams): Promise<unknown> {
    this.logger.info("complete.enter", {
      hasContext: !!params.context,
      argumentName: params.argument.name,
    });
    const result = await this.client.complete(params);
    this.logger.info("complete.exit", { argumentName: params.argument.name });
    return result;
  }

  async subscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    this.logger.info("subscribeResource.enter", { uri: params.uri });
    const result = await this.client.subscribeResource(params);
    this.logger.info("subscribeResource.exit", { uri: params.uri });
    return result;
  }

  async unsubscribeResource(params: ResourceSubscriptionParams): Promise<unknown> {
    this.logger.info("unsubscribeResource.enter", { uri: params.uri });
    const result = await this.client.unsubscribeResource(params);
    this.logger.info("unsubscribeResource.exit", { uri: params.uri });
    return result;
  }

  async listTools(params?: { cursor?: string }): Promise<unknown> {
    this.logger.info("listTools.enter", { cursor: params?.cursor });
    const result = await this.client.listTools(params);
    this.logger.info("listTools.exit", { cursor: params?.cursor });
    return result;
  }

  async readUiResource(uri: string): Promise<ToolUiResource> {
    this.logger.info("readUiResource.enter", { uri });
    const rawResource = await this.client.readResource({ uri });
    const resource = asRecord(rawResource);

    const contents = Array.isArray(resource?.contents) ? resource.contents : [];
    if (contents.length !== 1) {
      throw new Error(`Unexpected resource response for uri ${uri}`);
    }

    const content = asRecord(contents[0]);
    if (!content || typeof content.mimeType !== "string") {
      throw new Error(`Unexpected resource content payload for uri ${uri}`);
    }
    if (content.mimeType !== this.options.resourceMimeType) {
      throw new Error(`Unsupported UI resource MIME type: ${content.mimeType}`);
    }

    const html =
      typeof content.blob === "string"
        ? Buffer.from(content.blob, "base64").toString("utf8")
        : asString(content.text) ?? "";

    const contentMeta = parseUiResourceMeta(
      readUiResourceMetaCandidate(content as ResourceMetaContainer),
      "content-level",
      this.options.safeParseUiMeta,
    );
    const listingMeta = await this.readResourceListingMeta(uri);
    const uiMeta = contentMeta ?? listingMeta;

    const uiResource = {
      uiResourceUri: uri,
      html,
      csp: uiMeta?.csp,
      permissions: uiMeta?.permissions,
    };
    this.logger.info("readUiResource.exit", {
      uri,
      htmlBytes: uiResource.html.length,
      hasCsp: !!uiResource.csp,
      hasPermissions: !!uiResource.permissions,
    });
    return uiResource;
  }

  async listResources(params?: { cursor?: string }): Promise<unknown> {
    this.logger.info("listResources.enter", { cursor: params?.cursor });
    const result = await this.client.listResources(params);
    this.logger.info("listResources.exit", { cursor: params?.cursor });
    return result;
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    this.logger.info("readResource.enter", { uri: params.uri });
    const result = await this.client.readResource(params);
    this.logger.info("readResource.exit", { uri: params.uri });
    return result;
  }

  async listResourceTemplates(params?: { cursor?: string }): Promise<unknown> {
    this.logger.info("listResourceTemplates.enter", { cursor: params?.cursor });
    const result = await this.client.listResourceTemplates(params);
    this.logger.info("listResourceTemplates.exit", { cursor: params?.cursor });
    return result;
  }

  async listPrompts(params?: { cursor?: string }): Promise<unknown> {
    this.logger.info("listPrompts.enter", { cursor: params?.cursor });
    const result = await this.client.listPrompts(params);
    this.logger.info("listPrompts.exit", { cursor: params?.cursor });
    return result;
  }

  getServerCapabilities(): unknown {
    return this.client.getServerCapabilities() ?? {};
  }

  private async readResourceListingMeta(
    uri: string,
  ): Promise<UiResourceMeta | undefined> {
    this.logger.debug("readResourceListingMeta.enter", {
      uri,
      cacheSize: this.resourceCache.size,
    });
    if (!this.resourceCache.has(uri)) {
      const rawListing = await this.client.listResources();
      const listing = asRecord(rawListing);
      const resources = Array.isArray(listing?.resources) ? listing.resources : [];
      for (const resource of resources) {
        const resourceObj = asRecord(resource);
        const resourceUri = asString(resourceObj?.uri);
        if (resourceUri) {
          this.resourceCache.set(resourceUri, resourceObj);
        }
      }
    }

    const listingResource = this.resourceCache.get(uri) as ResourceMetaContainer | undefined;
    const parsedMeta = parseUiResourceMeta(
      readUiResourceMetaCandidate(listingResource),
      "listing-level",
      this.options.safeParseUiMeta,
    );
    this.logger.debug("readResourceListingMeta.exit", {
      uri,
      found: !!parsedMeta,
      cacheSize: this.resourceCache.size,
    });
    return parsedMeta;
  }
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
