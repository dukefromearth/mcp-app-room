import type {
  CapabilityGate,
  ExecutionContext,
  OperationId,
} from "./contracts";

interface CapabilityRule {
  capability: string;
  feature?: string;
}

const CAPABILITY_RULES: Record<OperationId, CapabilityRule> = {
  "tools.call": { capability: "tools" },
  "tools.list": { capability: "tools" },
  "resources.read": { capability: "resources" },
  "resources.list": { capability: "resources" },
  "resources.templates.list": { capability: "resources" },
  "resources.subscribe": { capability: "resources", feature: "subscribe" },
  "resources.unsubscribe": { capability: "resources", feature: "subscribe" },
  "prompts.get": { capability: "prompts" },
  "prompts.list": { capability: "prompts" },
  "completion.complete": { capability: "completions" },
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function hasCapability(
  capabilities: Record<string, unknown>,
  rule: CapabilityRule,
): boolean {
  const capabilityValue = capabilities[rule.capability];
  if (rule.feature === undefined) {
    return capabilityValue !== undefined && capabilityValue !== null;
  }
  const capabilityObject = asRecord(capabilityValue);
  return capabilityObject[rule.feature] === true;
}

async function gateByCapabilities(
  context: ExecutionContext,
  operationId: OperationId,
) {
  const rule = CAPABILITY_RULES[operationId];
  if (!rule) {
    return {
      allowed: false,
      reason: `No capability rule configured for operation "${operationId}".`,
    };
  }

  const capabilities = await context.protocol.getCapabilities(context.scope);
  if (!capabilities.ok) {
    return {
      allowed: false,
      reason: `Unable to load capabilities: ${capabilities.error.message}`,
    };
  }

  const capabilityPayload = capabilities.payload ?? {};
  if (!hasCapability(capabilityPayload, rule)) {
    const suffix = rule.feature ? `.${rule.feature}` : "";
    return {
      allowed: false,
      reason: `Operation requires capability "${rule.capability}${suffix}".`,
    };
  }

  return { allowed: true };
}

export function createDefaultGlobalCapabilityGate(): CapabilityGate {
  return (context, operationId) => gateByCapabilities(context, operationId);
}

