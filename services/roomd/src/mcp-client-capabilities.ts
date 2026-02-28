import { ClientCapabilityRegistry } from "./client-capabilities/registry";

interface RequestHandlerClient {
  setRequestHandler(schema: unknown, handler: (...args: unknown[]) => unknown): void;
}

export interface CapabilityRequestSchemas {
  listRootsRequestSchema: unknown;
  createMessageRequestSchema: unknown;
  elicitRequestSchema: unknown;
}

export function registerClientCapabilityHandlers(
  client: RequestHandlerClient,
  schemas: CapabilityRequestSchemas,
  advertisedCapabilities: Record<string, unknown>,
  roomId: string,
  serverKey: string,
  capabilityRegistry: ClientCapabilityRegistry | undefined,
): void {
  if (!capabilityRegistry) {
    return;
  }

  // Register only handlers we advertise so capability negotiation remains coherent.
  if (advertisedCapabilities.roots) {
    client.setRequestHandler(schemas.listRootsRequestSchema, async () => {
      return capabilityRegistry.buildRootsListResult(roomId, serverKey);
    });
  }

  if (advertisedCapabilities.sampling) {
    client.setRequestHandler(schemas.createMessageRequestSchema, async (request) => {
      const samplingRequest = request as { params: unknown };
      const decision = capabilityRegistry.evaluateSampling(
        roomId,
        serverKey,
        samplingRequest.params,
      );

      if (decision.action !== "approve") {
        throw new Error(
          `sampling/createMessage denied by policy: ${decision.reason ?? "denied"}`,
        );
      }

      if (!decision.response) {
        throw new Error("sampling/createMessage approved without response payload");
      }

      return decision.response as Record<string, unknown>;
    });
  }

  if (advertisedCapabilities.elicitation) {
    client.setRequestHandler(schemas.elicitRequestSchema, async (request) => {
      const elicitationRequest = request as { params: unknown };
      const decision = capabilityRegistry.evaluateElicitation(
        roomId,
        serverKey,
        elicitationRequest.params,
      );

      if (decision.action === "accept") {
        const content = asRecord(decision.response) ?? {};
        return {
          action: "accept",
          content,
        };
      }

      return {
        action: decision.action,
      };
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
