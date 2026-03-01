import type {
  DevSidebarConfig,
  ExecutionContext,
  ExecutionRecord,
  NormalizedResult,
  OperationDescriptor,
  WireEnvelope,
} from "./contracts";

function normalizeWireEnvelope(response: WireEnvelope<unknown>): NormalizedResult {
  if (response.ok) {
    return {
      kind: "success",
      summary: "Operation completed.",
      payload: response.payload,
    };
  }

  return {
    kind: "error",
    summary: response.error.message,
    payload: response.error,
  };
}

export async function executeDescriptor(
  config: DevSidebarConfig,
  descriptor: OperationDescriptor,
  context: ExecutionContext,
  input: unknown,
): Promise<ExecutionRecord> {
  const startedAtMs = context.now();

  const globalGate = await config.capabilityGate(context, descriptor.id, input);
  if (!globalGate.allowed) {
    const endedAtMs = context.now();
    return {
      executionId: `${descriptor.id}-${startedAtMs}`,
      operationId: descriptor.id,
      scope: context.scope,
      startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      input,
      result: {
        kind: "error",
        summary: globalGate.reason ?? "Blocked by global capability policy.",
        payload: {
          policy: "global-capability-gate",
        },
      },
    };
  }

  const descriptorGate = await descriptor.canRun(context, input);
  if (!descriptorGate.allowed) {
    const endedAtMs = context.now();
    return {
      executionId: `${descriptor.id}-${startedAtMs}`,
      operationId: descriptor.id,
      scope: context.scope,
      startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      input,
      result: {
        kind: "error",
        summary: descriptorGate.reason ?? "Blocked by descriptor policy.",
        payload: {
          policy: "operation-descriptor-gate",
        },
      },
    };
  }

  const response = await descriptor.execute(context, input);
  const endedAtMs = context.now();
  return {
    executionId: `${descriptor.id}-${startedAtMs}`,
    operationId: descriptor.id,
    scope: context.scope,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    input,
    result: normalizeWireEnvelope(response),
  };
}

