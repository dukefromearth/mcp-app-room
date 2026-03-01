import { useEffect, useMemo, useState } from "react";
import styles from "../index.module.css";
import type {
  DevSidebarTabId,
  ExecutionContext,
  ExecutionRecord,
  FormField,
  SidebarMountSnapshot,
} from "./contracts";
import { DEV_SIDEBAR_CONFIG } from "./default-config";
import { executeDescriptor } from "./engine";
import { FormFieldEditor } from "./form-field-editor";
import { createRoomdProtocolClient } from "./protocol-client";
import { buildFormPlan } from "./schema-adapters";

interface DevSidebarProps {
  roomdUrl: string;
  roomId: string;
  mounts: SidebarMountSnapshot[];
  selectedInstanceId: string | null;
}

type FormState = Record<string, string | boolean>;

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function initializeFieldValue(field: FormField): string | boolean {
  if (field.kind === "boolean") {
    return typeof field.defaultValue === "boolean" ? field.defaultValue : false;
  }
  if (field.kind === "json") {
    if (field.defaultValue !== undefined) {
      return JSON.stringify(field.defaultValue, null, 2);
    }
    return "{}";
  }
  if (field.defaultValue !== undefined) {
    return String(field.defaultValue);
  }
  return "";
}

function parseFormState(fields: FormField[], state: FormState): { value?: unknown; error?: string } {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const rawValue = state[field.key];
    if (field.required && (rawValue === "" || rawValue === undefined)) {
      return { error: `Field "${field.label}" is required.` };
    }

    if (rawValue === "" || rawValue === undefined) {
      continue;
    }

    if (field.kind === "boolean") {
      payload[field.key] = rawValue === true;
      continue;
    }

    if (field.kind === "number" || field.kind === "integer") {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        return { error: `Field "${field.label}" expects a number.` };
      }
      payload[field.key] = field.kind === "integer" ? Math.trunc(parsed) : parsed;
      continue;
    }

    if (field.kind === "json") {
      try {
        payload[field.key] = JSON.parse(String(rawValue));
      } catch {
        return { error: `Field "${field.label}" must contain valid JSON.` };
      }
      continue;
    }

    payload[field.key] = String(rawValue);
  }

  if ("payload" in payload && Object.keys(payload).length === 1) {
    return { value: payload.payload };
  }

  return { value: payload };
}

function createFormStateFromPayload(fields: FormField[], payload: unknown): FormState {
  const next: FormState = {};
  const payloadRecord =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;

  for (const field of fields) {
    const value = payloadRecord ? payloadRecord[field.key] : undefined;
    if (value === undefined) {
      next[field.key] = initializeFieldValue(field);
      continue;
    }

    if (field.kind === "boolean") {
      next[field.key] = value === true;
      continue;
    }

    if (field.kind === "json") {
      next[field.key] = stringifyJson(value);
      continue;
    }

    next[field.key] = String(value);
  }

  return next;
}

function chooseRenderer(record: ExecutionRecord): string {
  const renderer = DEV_SIDEBAR_CONFIG.resultRenderers.find((candidate) =>
    candidate.supports(record.result)
  );
  if (!renderer) {
    return JSON.stringify(record.result, null, 2);
  }

  const model = renderer.renderModel(record.result, {
    operationId: record.operationId,
  });
  return JSON.stringify(model, null, 2);
}

export function DevSidebar({
  roomdUrl,
  roomId,
  mounts,
  selectedInstanceId,
}: DevSidebarProps) {
  const protocol = useMemo(
    () => createRoomdProtocolClient(DEV_SIDEBAR_CONFIG.defaults.requestTimeoutMs),
    [],
  );
  const [activeTab, setActiveTab] = useState<DevSidebarTabId>(
    DEV_SIDEBAR_CONFIG.defaults.activeTab,
  );
  const [instanceId, setInstanceId] = useState<string>(selectedInstanceId ?? mounts[0]?.instanceId ?? "");
  const [operationId, setOperationId] = useState<string>("");
  const [rawMode, setRawMode] = useState(DEV_SIDEBAR_CONFIG.defaults.enableRawJsonByDefault);
  const [rawInput, setRawInput] = useState("{}");
  const [schemaText, setSchemaText] = useState("{}");
  const [formState, setFormState] = useState<FormState>({});
  const [history, setHistory] = useState<ExecutionRecord[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    if (selectedInstanceId && mounts.some((mount) => mount.instanceId === selectedInstanceId)) {
      setInstanceId(selectedInstanceId);
    } else if (!mounts.some((mount) => mount.instanceId === instanceId)) {
      setInstanceId(mounts[0]?.instanceId ?? "");
    }
  }, [instanceId, mounts, selectedInstanceId]);

  const selectedMount = useMemo(
    () => mounts.find((mount) => mount.instanceId === instanceId),
    [instanceId, mounts],
  );

  const tabOperations = useMemo(
    () => DEV_SIDEBAR_CONFIG.operations.filter((operation) => operation.tab === activeTab),
    [activeTab],
  );

  useEffect(() => {
    if (tabOperations.length === 0) {
      setOperationId("");
      return;
    }
    if (!tabOperations.some((operation) => operation.id === operationId)) {
      setOperationId(tabOperations[0].id);
    }
  }, [operationId, tabOperations]);

  const descriptor = useMemo(
    () => tabOperations.find((operation) => operation.id === operationId),
    [operationId, tabOperations],
  );

  const executionContext: ExecutionContext | null = useMemo(() => {
    if (!selectedMount) {
      return null;
    }
    return {
      scope: {
        roomdUrl,
        roomId,
        instanceId: selectedMount.instanceId,
      },
      mount: selectedMount,
      protocol,
      now: () => Date.now(),
    };
  }, [protocol, roomId, roomdUrl, selectedMount]);

  const [currentFields, setCurrentFields] = useState<FormField[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadSchema = async () => {
      if (!descriptor || !executionContext) {
        setCurrentFields([]);
        setSchemaText("{}");
        setRawInput("{}");
        setFormState({});
        return;
      }

      const schema = await descriptor.getInputSchema(executionContext);
      if (cancelled) {
        return;
      }
      setSchemaText(JSON.stringify(schema, null, 2));
      const plan = buildFormPlan(schema, DEV_SIDEBAR_CONFIG.schemaAdapters, descriptor.id);
      setCurrentFields(plan.fields);
      const initialState: FormState = {};
      for (const field of plan.fields) {
        initialState[field.key] = initializeFieldValue(field);
      }
      const parsed = parseFormState(plan.fields, initialState);
      setFormState(initialState);
      setRawInput(stringifyJson(parsed.value ?? {}));
    };

    loadSchema().catch((error) => {
      setRunError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      cancelled = true;
    };
  }, [descriptor, executionContext]);

  const latestRecord = history[0];

  const onRun = async () => {
    if (!descriptor || !executionContext) {
      return;
    }
    setIsRunning(true);
    setRunError(null);
    try {
      let inputPayload: unknown;
      if (rawMode) {
        inputPayload = JSON.parse(rawInput);
      } else {
        const parsed = parseFormState(currentFields, formState);
        if (parsed.error) {
          setRunError(parsed.error);
          return;
        }
        inputPayload = parsed.value ?? {};
      }

      const record = await executeDescriptor(
        DEV_SIDEBAR_CONFIG,
        descriptor,
        executionContext,
        inputPayload,
      );
      setHistory((previous) => [record, ...previous].slice(0, DEV_SIDEBAR_CONFIG.defaults.maxHistory));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRunning(false);
    }
  };

  const onToggleRawMode = (nextRawMode: boolean) => {
    if (nextRawMode) {
      const parsed = parseFormState(currentFields, formState);
      if (!parsed.error) {
        setRawInput(stringifyJson(parsed.value ?? {}));
      }
      setRawMode(true);
      return;
    }

    try {
      const parsedPayload = JSON.parse(rawInput);
      setFormState(createFormStateFromPayload(currentFields, parsedPayload));
      setRawMode(false);
      setRunError(null);
    } catch (error) {
      setRunError(
        error instanceof Error
          ? `Invalid JSON input: ${error.message}`
          : "Invalid JSON input.",
      );
    }
  };

  return (
    <aside className={styles.devSidebar}>
      <div className={styles.devSidebarHeader}>
        <h2>Dev Sidebar</h2>
        <p>Protocol console for mounted MCP instances.</p>
      </div>

      <section className={styles.devSection}>
        <h3>Scope</h3>
        <label>
          Instance
          <select
            value={instanceId}
            onChange={(event) => setInstanceId(event.target.value)}
          >
            {mounts.map((mount) => (
              <option key={mount.instanceId} value={mount.instanceId}>
                {mount.instanceId}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.devSection}>
        <h3>Ops</h3>
        <div className={styles.devTabs}>
          {DEV_SIDEBAR_CONFIG.features.tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={tab === activeTab ? styles.devTabActive : styles.devTab}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>
        <label>
          Operation
          <select
            value={operationId}
            onChange={(event) => setOperationId(event.target.value)}
          >
            {tabOperations.map((operation) => (
              <option key={operation.id} value={operation.id}>
                {operation.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.devSection}>
        <h3>Composer</h3>
        <label className={styles.devToggle}>
          <input
            type="checkbox"
            checked={rawMode}
            onChange={(event) => onToggleRawMode(event.target.checked)}
          />
          Raw JSON mode
        </label>
        {rawMode ? (
          <textarea
            className={styles.devTextarea}
            value={rawInput}
            onChange={(event) => setRawInput(event.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className={styles.devFormFields}>
            {currentFields.map((field) => (
              <FormFieldEditor
                key={field.key}
                field={field}
                value={formState[field.key]}
                onChange={(value) =>
                  setFormState((previous) => ({ ...previous, [field.key]: value }))
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className={styles.devSection}>
        <h3>Run</h3>
        <button type="button" onClick={() => void onRun()} disabled={isRunning || !descriptor}>
          {isRunning ? "Running..." : "Execute"}
        </button>
        {runError && <p className={styles.devError}>{runError}</p>}
      </section>

      <section className={styles.devSection}>
        <h3>Inspector</h3>
        {latestRecord ? (
          <>
            <p>
              {latestRecord.operationId} in {latestRecord.durationMs}ms
            </p>
            <pre className={styles.devPre}>{chooseRenderer(latestRecord)}</pre>
            <button
              type="button"
              onClick={() => setHistory([])}
            >
              Clear History
            </button>
          </>
        ) : (
          <p>No executions yet.</p>
        )}
      </section>

      <section className={styles.devSection}>
        <h3>Schema</h3>
        <pre className={styles.devPre}>{schemaText}</pre>
      </section>
    </aside>
  );
}
