/**
 * Contract-first interfaces for the dev sidebar protocol console.
 *
 * Keep this file free of React/runtime implementation details so the protocol
 * runner and UI layers can evolve independently.
 */

export const DEV_SIDEBAR_TAB_IDS = [
  "tools",
  "resources",
  "prompts",
  "completion",
] as const;
export type DevSidebarTabId = (typeof DEV_SIDEBAR_TAB_IDS)[number];

export const OPERATION_IDS = [
  "tools.call",
  "tools.list",
  "resources.read",
  "resources.list",
  "resources.templates.list",
  "resources.subscribe",
  "resources.unsubscribe",
  "prompts.get",
  "prompts.list",
  "completion.complete",
] as const;
export type OperationId = (typeof OPERATION_IDS)[number];

export interface SidebarMountTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  visibility?: Array<"model" | "app">;
}

export interface SidebarMountSnapshot {
  instanceId: string;
  server: string;
  uiResourceUri?: string;
  tools: SidebarMountTool[];
}

export interface SidebarScope {
  roomdUrl: string;
  roomId: string;
  instanceId: string;
}

export interface WireError {
  status: number;
  message: string;
  code?: string;
  details?: unknown;
  hint?: string;
}

export interface WireSuccess<TPayload = unknown> {
  ok: true;
  status: number;
  payload: TPayload;
}

export interface WireFailure {
  ok: false;
  error: WireError;
}

export type WireEnvelope<TPayload = unknown> = WireSuccess<TPayload> | WireFailure;

export interface PaginatedPayload {
  nextCursor?: string;
  [key: string]: unknown;
}

export interface ProtocolClientAdapter {
  listTools(
    scope: SidebarScope,
    params?: { cursor?: string },
  ): Promise<WireEnvelope<PaginatedPayload>>;
  callTool(
    scope: SidebarScope,
    params: { name: string; arguments?: Record<string, unknown> },
  ): Promise<WireEnvelope<unknown>>;
  listResources(
    scope: SidebarScope,
    params?: { cursor?: string },
  ): Promise<WireEnvelope<PaginatedPayload>>;
  readResource(
    scope: SidebarScope,
    params: { uri: string },
  ): Promise<WireEnvelope<unknown>>;
  listResourceTemplates(
    scope: SidebarScope,
    params?: { cursor?: string },
  ): Promise<WireEnvelope<PaginatedPayload>>;
  subscribeResource(
    scope: SidebarScope,
    params: { uri: string },
  ): Promise<WireEnvelope<unknown>>;
  unsubscribeResource(
    scope: SidebarScope,
    params: { uri: string },
  ): Promise<WireEnvelope<unknown>>;
  listPrompts(
    scope: SidebarScope,
    params?: { cursor?: string },
  ): Promise<WireEnvelope<PaginatedPayload>>;
  getPrompt(
    scope: SidebarScope,
    params: { name: string; arguments?: Record<string, unknown> },
  ): Promise<WireEnvelope<unknown>>;
  complete(
    scope: SidebarScope,
    params: {
      ref: { type: "ref/resource" | "ref/prompt"; uri?: string; name?: string };
      argument: { name: string; value: string };
    },
  ): Promise<WireEnvelope<unknown>>;
  getCapabilities(
    scope: SidebarScope,
  ): Promise<WireEnvelope<Record<string, unknown> | null>>;
  getState(
    scope: Pick<SidebarScope, "roomdUrl" | "roomId">,
  ): Promise<WireEnvelope<Record<string, unknown>>>;
}

export interface ExecutionContext {
  scope: SidebarScope;
  mount?: SidebarMountSnapshot;
  protocol: ProtocolClientAdapter;
  now: () => number;
}

export interface CapabilityGateResult {
  allowed: boolean;
  reason?: string;
}

export type CapabilityGate = (
  context: ExecutionContext,
  operationId: OperationId,
  input: unknown,
) => Promise<CapabilityGateResult>;

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export const FORM_FIELD_KINDS = [
  "text",
  "number",
  "integer",
  "boolean",
  "select",
  "json",
  "object",
  "array",
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

export interface FormField {
  key: string;
  label: string;
  description?: string;
  kind: FormFieldKind;
  required?: boolean;
  defaultValue?: unknown;
  options?: SelectOption[];
}

export interface FormPlan {
  title?: string;
  description?: string;
  fields: FormField[];
  rawJsonFallback: true;
}

export interface SchemaAdapterContext {
  operationId: OperationId;
}

export interface SchemaAdapter {
  id: string;
  canAdapt(schema: unknown): boolean;
  adapt(schema: unknown, context: SchemaAdapterContext): FormPlan;
}

export interface OperationDescriptor {
  id: OperationId;
  tab: DevSidebarTabId;
  label: string;
  description: string;
  getInputSchema(context: ExecutionContext): Promise<unknown>;
  canRun(context: ExecutionContext, input: unknown): Promise<CapabilityGateResult>;
  execute(context: ExecutionContext, input: unknown): Promise<WireEnvelope<unknown>>;
}

export interface NormalizedResult {
  kind: "success" | "error";
  summary: string;
  payload: unknown;
}

export interface ResultRenderContext {
  operationId: OperationId;
}

export interface ResultRenderer {
  id: string;
  supports(result: NormalizedResult): boolean;
  renderModel(result: NormalizedResult, context: ResultRenderContext): unknown;
}

export interface ExecutionRecord {
  executionId: string;
  operationId: OperationId;
  scope: SidebarScope;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  input: unknown;
  result: NormalizedResult;
}

export interface DevSidebarDefaults {
  activeTab: DevSidebarTabId;
  requestTimeoutMs: number;
  maxHistory: number;
  enableRawJsonByDefault: boolean;
}

export interface DevSidebarFeatures {
  visible: boolean;
  tabs: ReadonlyArray<DevSidebarTabId>;
}

export interface DevSidebarConfig {
  defaults: DevSidebarDefaults;
  features: DevSidebarFeatures;
  capabilityGate: CapabilityGate;
  operations: ReadonlyArray<OperationDescriptor>;
  schemaAdapters: ReadonlyArray<SchemaAdapter>;
  resultRenderers: ReadonlyArray<ResultRenderer>;
}
