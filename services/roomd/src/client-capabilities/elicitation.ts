import type {
  ClientElicitationConfig,
  ElicitationPreviewResult,
} from "../types";

export function defaultElicitationConfig(): ClientElicitationConfig {
  return {
    enabled: false,
    allowFormMode: true,
    allowUrlMode: true,
    requireUrlForSensitive: true,
    sensitiveFieldKeywords: [
      "password",
      "secret",
      "token",
      "credential",
      "apiKey",
      "ssn",
      "privateKey",
    ],
    defaultAction: "decline",
  };
}

export function mergeElicitationConfig(
  current: ClientElicitationConfig,
  patch: Partial<ClientElicitationConfig> | undefined,
): ClientElicitationConfig {
  if (!patch) {
    return cloneElicitationConfig(current);
  }

  return {
    enabled: patch.enabled ?? current.enabled,
    allowFormMode: patch.allowFormMode ?? current.allowFormMode,
    allowUrlMode: patch.allowUrlMode ?? current.allowUrlMode,
    requireUrlForSensitive:
      patch.requireUrlForSensitive ?? current.requireUrlForSensitive,
    sensitiveFieldKeywords: patch.sensitiveFieldKeywords
      ? sanitizeKeywords(patch.sensitiveFieldKeywords)
      : [...current.sensitiveFieldKeywords],
    defaultAction: patch.defaultAction ?? current.defaultAction,
  };
}

export function evaluateElicitationRequest(
  config: ClientElicitationConfig,
  rawParams: unknown,
): ElicitationPreviewResult {
  if (!config.enabled) {
    return {
      action: config.defaultAction,
      reason: "elicitation capability is disabled",
    };
  }

  const mode = readMode(rawParams);

  if (mode === "url") {
    if (!config.allowUrlMode) {
      return {
        action: config.defaultAction,
        reason: "URL mode elicitation is disabled by policy",
      };
    }

    return { action: "accept" };
  }

  if (!config.allowFormMode) {
    return {
      action: config.defaultAction,
      reason: "form mode elicitation is disabled by policy",
    };
  }

  if (
    config.requireUrlForSensitive &&
    hasSensitiveFormFields(rawParams, config.sensitiveFieldKeywords)
  ) {
    return {
      action: config.defaultAction,
      reason: "sensitive elicitation requires URL mode by policy",
    };
  }

  return {
    action: "accept",
    response: readDefaultFormValues(rawParams),
  };
}

function readMode(rawParams: unknown): "form" | "url" {
  if (!rawParams || typeof rawParams !== "object") {
    return "form";
  }

  const mode = (rawParams as Record<string, unknown>).mode;
  return mode === "url" ? "url" : "form";
}

function hasSensitiveFormFields(
  rawParams: unknown,
  keywords: string[],
): boolean {
  const schema = readRequestedSchema(rawParams);
  const properties =
    schema && typeof schema === "object"
      ? (schema as { properties?: unknown }).properties
      : undefined;

  if (!properties || typeof properties !== "object") {
    return false;
  }

  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());

  for (const [name, value] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    const haystack = `${name} ${JSON.stringify(value)}`.toLowerCase();
    if (loweredKeywords.some((keyword) => haystack.includes(keyword))) {
      return true;
    }
  }

  return false;
}

function readDefaultFormValues(rawParams: unknown): Record<string, unknown> {
  const schema = readRequestedSchema(rawParams);
  const properties =
    schema && typeof schema === "object"
      ? (schema as { properties?: unknown }).properties
      : undefined;

  if (!properties || typeof properties !== "object") {
    return {};
  }

  const defaults: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    if (!field || typeof field !== "object") {
      continue;
    }

    const defaultValue = (field as { default?: unknown }).default;
    if (defaultValue !== undefined) {
      defaults[name] = defaultValue;
    }
  }

  return defaults;
}

function readRequestedSchema(rawParams: unknown): unknown {
  if (!rawParams || typeof rawParams !== "object") {
    return undefined;
  }

  return (rawParams as Record<string, unknown>).requestedSchema;
}

function sanitizeKeywords(keywords: string[]): string[] {
  const deduped = new Set<string>();

  for (const keyword of keywords) {
    const normalized = keyword.trim();
    if (normalized.length > 0) {
      deduped.add(normalized);
    }
  }

  return [...deduped];
}

function cloneElicitationConfig(
  config: ClientElicitationConfig,
): ClientElicitationConfig {
  return {
    enabled: config.enabled,
    allowFormMode: config.allowFormMode,
    allowUrlMode: config.allowUrlMode,
    requireUrlForSensitive: config.requireUrlForSensitive,
    sensitiveFieldKeywords: [...config.sensitiveFieldKeywords],
    defaultAction: config.defaultAction,
  };
}
