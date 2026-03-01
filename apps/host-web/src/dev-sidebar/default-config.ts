import { DEV_SIDEBAR_TAB_IDS, type DevSidebarConfig } from "./contracts";
import { createDefaultGlobalCapabilityGate } from "./gates";
import { createDefaultOperationDescriptors } from "./operations";
import { DEFAULT_RESULT_RENDERERS } from "./result-renderers";
import { DEFAULT_SCHEMA_ADAPTERS } from "./schema-adapters";

function validateUniqueIds(label: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label} id: ${id}`);
    }
    seen.add(id);
  }
}

export function validateDevSidebarConfig(config: DevSidebarConfig): DevSidebarConfig {
  if (config.operations.length === 0) {
    throw new Error("Dev sidebar config must register at least one operation.");
  }

  if (!config.features.tabs.includes(config.defaults.activeTab)) {
    throw new Error(
      `Default active tab "${config.defaults.activeTab}" is not present in enabled tabs.`,
    );
  }

  const operationIds = config.operations.map((operation) => operation.id);
  validateUniqueIds("operation", operationIds);

  for (const operation of config.operations) {
    if (!config.features.tabs.includes(operation.tab)) {
      throw new Error(
        `Operation "${operation.id}" maps to disabled tab "${operation.tab}".`,
      );
    }
    if (typeof operation.canRun !== "function") {
      throw new Error(`Operation "${operation.id}" is missing canRun gate.`);
    }
  }

  validateUniqueIds(
    "schema adapter",
    config.schemaAdapters.map((adapter) => adapter.id),
  );
  validateUniqueIds(
    "result renderer",
    config.resultRenderers.map((renderer) => renderer.id),
  );

  return config;
}

/**
 * Single composition root for dev-sidebar behavior.
 *
 * GOTCHA: register new operations/adapters/renderers here. Avoid adding
 * operation-specific branches in shared UI components.
 */
export const DEV_SIDEBAR_CONFIG: DevSidebarConfig = {
  defaults: {
    activeTab: "tools",
    requestTimeoutMs: 20_000,
    maxHistory: 200,
    enableRawJsonByDefault: false,
  },
  features: {
    visible: true,
    tabs: [...DEV_SIDEBAR_TAB_IDS],
  },
  capabilityGate: createDefaultGlobalCapabilityGate(),
  operations: createDefaultOperationDescriptors(),
  schemaAdapters: DEFAULT_SCHEMA_ADAPTERS,
  resultRenderers: DEFAULT_RESULT_RENDERERS,
};

validateDevSidebarConfig(DEV_SIDEBAR_CONFIG);
