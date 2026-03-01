import type {
  PaginatedPayload,
  ProtocolClientAdapter,
  SidebarScope,
  WireEnvelope,
} from "./contracts";
import { asRecord } from "./utils";

interface JsonRequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  timeoutMs: number;
}

const INSTANCE_ENDPOINTS = {
  listTools: { suffix: "/tools/list", method: "POST", kind: "paginated" },
  callTool: { suffix: "/tools/call", method: "POST", kind: "raw" },
  listResources: { suffix: "/resources/list", method: "POST", kind: "paginated" },
  readResource: { suffix: "/resources/read", method: "POST", kind: "raw" },
  listResourceTemplates: {
    suffix: "/resources/templates/list",
    method: "POST",
    kind: "paginated",
  },
  subscribeResource: { suffix: "/resources/subscribe", method: "POST", kind: "raw" },
  unsubscribeResource: { suffix: "/resources/unsubscribe", method: "POST", kind: "raw" },
  listPrompts: { suffix: "/prompts/list", method: "POST", kind: "paginated" },
  getPrompt: { suffix: "/prompts/get", method: "POST", kind: "raw" },
  complete: { suffix: "/completion/complete", method: "POST", kind: "raw" },
} as const;

type InstanceEndpointKey = keyof typeof INSTANCE_ENDPOINTS;

function instancePath(scope: SidebarScope, suffix: string): string {
  return `/rooms/${encodeURIComponent(scope.roomId)}/instances/${encodeURIComponent(scope.instanceId)}${suffix}`;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function unwrapPayload<TValue>(
  envelope: WireEnvelope<unknown>,
  picker: (value: unknown) => TValue,
): WireEnvelope<TValue> {
  if (!envelope.ok) {
    return envelope;
  }
  return {
    ok: true,
    status: envelope.status,
    payload: picker(envelope.payload),
  };
}

function asPaginatedPayload(value: unknown): PaginatedPayload {
  return asRecord(value);
}

async function requestJson(
  baseUrl: string,
  path: string,
  options: JsonRequestOptions,
): Promise<WireEnvelope<unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  let response: Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: options.method,
      headers:
        options.body === undefined
          ? undefined
          : {
              "content-type": "application/json",
            },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: {
          status: 408,
          message: `Request timed out after ${options.timeoutMs}ms`,
          code: "REQUEST_TIMEOUT",
        },
      };
    }
    return {
      ok: false,
      error: {
        status: 503,
        message: error instanceof Error ? error.message : String(error),
        code: "TRANSPORT_ERROR",
      },
    };
  }

  clearTimeout(timeoutId);

  const payload = await safeJson(response);
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      payload,
    };
  }

  const errorPayload = asRecord(payload);
  return {
    ok: false,
    error: {
      status: response.status,
      message:
        typeof errorPayload.error === "string"
          ? errorPayload.error
          : `${response.status} ${response.statusText}`,
      ...(typeof errorPayload.code === "string" ? { code: errorPayload.code } : {}),
      ...("details" in errorPayload ? { details: errorPayload.details } : {}),
      ...(typeof errorPayload.hint === "string" ? { hint: errorPayload.hint } : {}),
    },
  };
}

async function callInstanceEndpoint(
  scope: SidebarScope,
  key: InstanceEndpointKey,
  timeoutMs: number,
  body?: unknown,
): Promise<WireEnvelope<unknown>> {
  const endpoint = INSTANCE_ENDPOINTS[key];
  return requestJson(scope.roomdUrl, instancePath(scope, endpoint.suffix), {
    method: endpoint.method,
    body,
    timeoutMs,
  });
}

function callInstancePaginatedEndpoint(
  scope: SidebarScope,
  key: InstanceEndpointKey,
  timeoutMs: number,
  body?: unknown,
): Promise<WireEnvelope<PaginatedPayload>> {
  return callInstanceEndpoint(scope, key, timeoutMs, body).then((envelope) =>
    unwrapPayload(envelope, asPaginatedPayload)
  );
}

export function createRoomdProtocolClient(requestTimeoutMs = 20_000): ProtocolClientAdapter {
  return {
    listTools(scope, params) {
      return callInstancePaginatedEndpoint(scope, "listTools", requestTimeoutMs, params ?? {});
    },
    callTool(scope, params) {
      return callInstanceEndpoint(scope, "callTool", requestTimeoutMs, params);
    },
    listResources(scope, params) {
      return callInstancePaginatedEndpoint(scope, "listResources", requestTimeoutMs, params ?? {});
    },
    readResource(scope, params) {
      return callInstanceEndpoint(scope, "readResource", requestTimeoutMs, params);
    },
    listResourceTemplates(scope, params) {
      return callInstancePaginatedEndpoint(
        scope,
        "listResourceTemplates",
        requestTimeoutMs,
        params ?? {},
      );
    },
    subscribeResource(scope, params) {
      return callInstanceEndpoint(scope, "subscribeResource", requestTimeoutMs, params);
    },
    unsubscribeResource(scope, params) {
      return callInstanceEndpoint(scope, "unsubscribeResource", requestTimeoutMs, params);
    },
    listPrompts(scope, params) {
      return callInstancePaginatedEndpoint(scope, "listPrompts", requestTimeoutMs, params ?? {});
    },
    getPrompt(scope, params) {
      return callInstanceEndpoint(scope, "getPrompt", requestTimeoutMs, params);
    },
    complete(scope, params) {
      return callInstanceEndpoint(scope, "complete", requestTimeoutMs, params);
    },
    async getCapabilities(scope) {
      const response = await requestJson(
        scope.roomdUrl,
        instancePath(scope, "/capabilities"),
        { method: "GET", timeoutMs: requestTimeoutMs },
      );
      return unwrapPayload(response, (value) => {
        const capabilities = asRecord(value).capabilities;
        if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
          return capabilities as Record<string, unknown>;
        }
        return null;
      });
    },
    async getState(scope) {
      const response = await requestJson(
        scope.roomdUrl,
        `/rooms/${encodeURIComponent(scope.roomId)}/state`,
        { method: "GET", timeoutMs: requestTimeoutMs },
      );
      return unwrapPayload(response, (value) => {
        const state = asRecord(value).state;
        if (state && typeof state === "object" && !Array.isArray(state)) {
          return state as Record<string, unknown>;
        }
        return {};
      });
    },
  };
}

