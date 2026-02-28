import type {
  ClientRoot,
  ElicitationPreviewResult,
  InstanceClientCapabilitiesConfig,
  MountClientCapabilitiesConfig,
  SamplingPreviewResult,
} from "../types";
import {
  defaultElicitationConfig,
  evaluateElicitationRequest,
  mergeElicitationConfig,
} from "./elicitation";
import {
  defaultRootsConfig,
  mergeRootsConfig,
  normalizeRoots,
} from "./roots";
import {
  defaultSamplingConfig,
  evaluateSamplingRequest,
  mergeSamplingConfig,
} from "./sampling";

interface CapabilityRuntime {
  roots: ReturnType<typeof defaultRootsConfig>;
  sampling: ReturnType<typeof defaultSamplingConfig>;
  elicitation: ReturnType<typeof defaultElicitationConfig>;
}

export class ClientCapabilityRegistry {
  private readonly runtimes = new Map<string, CapabilityRuntime>();

  configureForMount(
    roomId: string,
    server: string,
    patch: MountClientCapabilitiesConfig | undefined,
  ): InstanceClientCapabilitiesConfig {
    const current = this.ensureRuntime(roomId, server);

    current.roots = mergeRootsConfig(current.roots, patch?.roots);
    current.sampling = mergeSamplingConfig(current.sampling, patch?.sampling);
    current.elicitation = mergeElicitationConfig(
      current.elicitation,
      patch?.elicitation,
    );

    return this.snapshot(current);
  }

  getSnapshot(roomId: string, server: string): InstanceClientCapabilitiesConfig {
    return this.snapshot(this.ensureRuntime(roomId, server));
  }

  setRoots(
    roomId: string,
    server: string,
    roots: ClientRoot[],
  ): InstanceClientCapabilitiesConfig {
    const runtime = this.ensureRuntime(roomId, server);
    runtime.roots = {
      ...runtime.roots,
      roots: normalizeRoots(roots),
    };
    return this.snapshot(runtime);
  }

  updateSampling(
    roomId: string,
    server: string,
    patch: Partial<InstanceClientCapabilitiesConfig["sampling"]>,
  ): InstanceClientCapabilitiesConfig {
    const runtime = this.ensureRuntime(roomId, server);
    runtime.sampling = mergeSamplingConfig(runtime.sampling, patch);
    return this.snapshot(runtime);
  }

  updateElicitation(
    roomId: string,
    server: string,
    patch: Partial<InstanceClientCapabilitiesConfig["elicitation"]>,
  ): InstanceClientCapabilitiesConfig {
    const runtime = this.ensureRuntime(roomId, server);
    runtime.elicitation = mergeElicitationConfig(runtime.elicitation, patch);
    return this.snapshot(runtime);
  }

  getAdvertisedClientCapabilities(
    roomId: string,
    server: string,
  ): Record<string, unknown> {
    const runtime = this.ensureRuntime(roomId, server);

    const capabilities: Record<string, unknown> = {};

    if (runtime.roots.enabled) {
      capabilities.roots = {
        listChanged: runtime.roots.listChanged,
      };
    }

    if (runtime.sampling.enabled) {
      capabilities.sampling = {
        context: {},
        tools: runtime.sampling.allowToolUse ? {} : undefined,
      };
    }

    if (runtime.elicitation.enabled) {
      const elicitation: Record<string, unknown> = {};

      if (runtime.elicitation.allowFormMode) {
        elicitation.form = {
          applyDefaults: true,
        };
      }

      if (runtime.elicitation.allowUrlMode) {
        elicitation.url = {};
      }

      if (Object.keys(elicitation).length > 0) {
        capabilities.elicitation = elicitation;
      }
    }

    return capabilities;
  }

  buildRootsListResult(roomId: string, server: string): { roots: ClientRoot[] } {
    const runtime = this.ensureRuntime(roomId, server);
    return {
      roots: normalizeRoots(runtime.roots.roots),
    };
  }

  evaluateSampling(
    roomId: string,
    server: string,
    rawParams: unknown,
  ): SamplingPreviewResult {
    const runtime = this.ensureRuntime(roomId, server);
    return evaluateSamplingRequest(runtime.sampling, rawParams);
  }

  evaluateElicitation(
    roomId: string,
    server: string,
    rawParams: unknown,
  ): ElicitationPreviewResult {
    const runtime = this.ensureRuntime(roomId, server);
    return evaluateElicitationRequest(runtime.elicitation, rawParams);
  }

  clear(roomId: string, server: string): void {
    this.runtimes.delete(runtimeKey(roomId, server));
  }

  private ensureRuntime(roomId: string, server: string): CapabilityRuntime {
    const key = runtimeKey(roomId, server);
    const existing = this.runtimes.get(key);
    if (existing) {
      return existing;
    }

    const created: CapabilityRuntime = {
      roots: defaultRootsConfig(),
      sampling: defaultSamplingConfig(),
      elicitation: defaultElicitationConfig(),
    };

    this.runtimes.set(key, created);
    return created;
  }

  private snapshot(runtime: CapabilityRuntime): InstanceClientCapabilitiesConfig {
    return {
      roots: {
        enabled: runtime.roots.enabled,
        listChanged: runtime.roots.listChanged,
        roots: normalizeRoots(runtime.roots.roots),
      },
      sampling: {
        enabled: runtime.sampling.enabled,
        requireHumanInTheLoop: runtime.sampling.requireHumanInTheLoop,
        allowToolUse: runtime.sampling.allowToolUse,
        maxOutputTokens: runtime.sampling.maxOutputTokens,
        defaultModel: runtime.sampling.defaultModel,
      },
      elicitation: {
        enabled: runtime.elicitation.enabled,
        allowFormMode: runtime.elicitation.allowFormMode,
        allowUrlMode: runtime.elicitation.allowUrlMode,
        requireUrlForSensitive: runtime.elicitation.requireUrlForSensitive,
        sensitiveFieldKeywords: [...runtime.elicitation.sensitiveFieldKeywords],
        defaultAction: runtime.elicitation.defaultAction,
      },
    };
  }
}

function runtimeKey(roomId: string, server: string): string {
  return `${roomId}::${server}`;
}
