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
    // GOTCHA: stdio subprocess shutdown fallback (SIGTERM/SIGKILL) is delegated
    // to SDK transport close implementation; this must always run on release.
    await this.client.close();
  }

  async notifyRootsListChanged(): Promise<void> {
    await this.client.notification({
      method: "notifications/roots/list_changed",
    });
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
    return parseUiResourceMeta(
      readUiResourceMetaCandidate(listingResource),
      "listing-level",
      this.options.safeParseUiMeta,
    );
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
