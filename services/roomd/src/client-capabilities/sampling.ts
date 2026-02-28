import type { ClientSamplingConfig, SamplingPreviewResult } from "../types";

export function defaultSamplingConfig(): ClientSamplingConfig {
  return {
    enabled: false,
    requireHumanInTheLoop: true,
    allowToolUse: false,
    maxOutputTokens: 2048,
    defaultModel: "gpt-4.1-mini",
  };
}

export function mergeSamplingConfig(
  current: ClientSamplingConfig,
  patch: Partial<ClientSamplingConfig> | undefined,
): ClientSamplingConfig {
  if (!patch) {
    return { ...current };
  }

  return {
    enabled: patch.enabled ?? current.enabled,
    requireHumanInTheLoop:
      patch.requireHumanInTheLoop ?? current.requireHumanInTheLoop,
    allowToolUse: patch.allowToolUse ?? current.allowToolUse,
    maxOutputTokens: sanitizeMaxTokens(
      patch.maxOutputTokens ?? current.maxOutputTokens,
    ),
    defaultModel: sanitizeModel(patch.defaultModel ?? current.defaultModel),
  };
}

export function evaluateSamplingRequest(
  config: ClientSamplingConfig,
  rawParams: unknown,
): SamplingPreviewResult {
  if (!config.enabled) {
    return {
      action: "deny",
      reason: "sampling capability is disabled",
    };
  }

  if (config.requireHumanInTheLoop) {
    return {
      action: "deny",
      reason: "sampling requires human approval by policy",
    };
  }

  const maxTokens = readNumberField(rawParams, "maxTokens");
  if (maxTokens !== undefined && maxTokens > config.maxOutputTokens) {
    return {
      action: "deny",
      reason: `sampling maxTokens ${maxTokens} exceeds policy limit ${config.maxOutputTokens}`,
    };
  }

  const requestedTools = readArrayField(rawParams, "tools");
  if (!config.allowToolUse && requestedTools.length > 0) {
    return {
      action: "deny",
      reason: "sampling with tools is disabled by policy",
    };
  }

  return {
    action: "approve",
    response: {
      role: "assistant",
      model: config.defaultModel,
      stopReason: "endTurn",
      content: [
        {
          type: "text",
          text: "roomd sampling adapter approved request",
        },
      ],
    },
  };
}

function sanitizeMaxTokens(value: number): number {
  const rounded = Number.isFinite(value) ? Math.trunc(value) : 2048;
  if (rounded < 1) {
    return 1;
  }
  if (rounded > 32768) {
    return 32768;
  }
  return rounded;
}

function sanitizeModel(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "gpt-4.1-mini";
}

function readNumberField(value: unknown, field: string): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = (value as Record<string, unknown>)[field];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readArrayField(value: unknown, field: string): unknown[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const raw = (value as Record<string, unknown>)[field];
  return Array.isArray(raw) ? raw : [];
}
