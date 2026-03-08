# ADR: Dev Sidebar Protocol Console Contracts (2026-02-28)

## Status
Accepted

## Objective
Define explicit, stable, contract-first interfaces for a reusable dev sidebar that can execute MCP operations for any mounted instance (UI-backed or headless), with registration-based extension and minimal refactor cost.

## Constraints
- Must align with MCP core (`tools/*`, `resources/*`, `prompts/*`, `completion/*`) and Apps extension gating behavior where applicable.
- Must preserve host boundary rules: protocol boundaries in integration modules, presentation in UI modules.
- Must centralize capability and visibility policy checks.
- Must scale by descriptor/adapter registration, not per-operation branching.
- Must centralize configuration in one composition-root file.

## Source Of Truth
- Contracts: `apps/host-web/src/dev-sidebar/contracts.ts`
- Composition root config: `apps/host-web/src/dev-sidebar/default-config.ts`
- Directory boundary policy: `apps/host-web/src/dev-sidebar/README.md`

If this ADR and contract code diverge, `contracts.ts` is authoritative and this ADR must be updated in the same change.

## Normative Contract Schemas (YAML)
```yaml
contract:
  version: "1.0.0"
  sourceOfTruth:
    contractsTs: "apps/host-web/src/dev-sidebar/contracts.ts"
    configTs: "apps/host-web/src/dev-sidebar/default-config.ts"

enums:
  DevSidebarTabId:
    - tools
    - resources
    - prompts
    - completion
  OperationId:
    - tools.call
    - tools.list
    - resources.read
    - resources.list
    - resources.templates.list
    - resources.subscribe
    - resources.unsubscribe
    - prompts.get
    - prompts.list
    - completion.complete
  FormFieldKind:
    - text
    - number
    - integer
    - boolean
    - select
    - json
    - object
    - array
  NormalizedResultKind:
    - success
    - error

schemas:
  SidebarScope:
    type: object
    required: [roomdUrl, roomId, instanceId]
    properties:
      roomdUrl: { type: string, format: uri }
      roomId: { type: string, minLength: 1 }
      instanceId: { type: string, minLength: 1 }

  ListCursorParams:
    type: object
    properties:
      cursor: { type: string }

  ToolCallParams:
    type: object
    required: [name]
    properties:
      name: { type: string, minLength: 1 }
      arguments:
        type: object
        additionalProperties: true

  ResourceUriParams:
    type: object
    required: [uri]
    properties:
      uri: { type: string, minLength: 1 }

  PromptGetParams:
    type: object
    required: [name]
    properties:
      name: { type: string, minLength: 1 }
      arguments:
        type: object
        additionalProperties: true

  CompletionCompleteParams:
    type: object
    required: [ref, argument]
    properties:
      ref:
        type: object
        required: [type]
        properties:
          type:
            type: string
            enum: [ref/resource, ref/prompt]
          uri: { type: string }
          name: { type: string }
      argument:
        type: object
        required: [name, value]
        properties:
          name: { type: string, minLength: 1 }
          value: { type: string }

  CapabilityGateResult:
    type: object
    required: [allowed]
    properties:
      allowed: { type: boolean }
      reason: { type: string }

  SelectOption:
    type: object
    required: [value, label]
    properties:
      value: { type: string }
      label: { type: string }
      description: { type: string }

  FormField:
    type: object
    required: [key, label, kind]
    properties:
      key: { type: string, minLength: 1 }
      label: { type: string, minLength: 1 }
      description: { type: string }
      kind: { $ref: "#/enums/FormFieldKind" }
      required: { type: boolean }
      defaultValue: {}
      options:
        type: array
        items: { $ref: "#/schemas/SelectOption" }

  FormPlan:
    type: object
    required: [fields, rawJsonFallback]
    properties:
      title: { type: string }
      description: { type: string }
      fields:
        type: array
        items: { $ref: "#/schemas/FormField" }
      rawJsonFallback:
        type: boolean
        const: true

  NormalizedResult:
    type: object
    required: [kind, summary, payload]
    properties:
      kind: { $ref: "#/enums/NormalizedResultKind" }
      summary: { type: string, minLength: 1 }
      payload: {}

  ExecutionRecord:
    type: object
    required:
      - executionId
      - operationId
      - scope
      - startedAtMs
      - endedAtMs
      - durationMs
      - input
      - result
    properties:
      executionId: { type: string, minLength: 1 }
      operationId: { $ref: "#/enums/OperationId" }
      scope: { $ref: "#/schemas/SidebarScope" }
      startedAtMs: { type: number }
      endedAtMs: { type: number }
      durationMs: { type: number, minimum: 0 }
      input: {}
      result: { $ref: "#/schemas/NormalizedResult" }

  DevSidebarDefaults:
    type: object
    required: [activeTab, requestTimeoutMs, maxHistory, enableRawJsonByDefault]
    properties:
      activeTab: { $ref: "#/enums/DevSidebarTabId" }
      requestTimeoutMs: { type: integer, minimum: 1 }
      maxHistory: { type: integer, minimum: 1 }
      enableRawJsonByDefault: { type: boolean }

  DevSidebarFeatures:
    type: object
    required: [visible, tabs]
    properties:
      visible: { type: boolean }
      tabs:
        type: array
        items: { $ref: "#/enums/DevSidebarTabId" }

  WireError:
    type: object
    required: [status, message]
    properties:
      status: { type: integer, minimum: 100, maximum: 599 }
      message: { type: string, minLength: 1 }
      code: { type: string }
      details: {}
      hint: { type: string }

  WireSuccess:
    type: object
    required: [ok, status, payload]
    properties:
      ok: { type: boolean, const: true }
      status: { type: integer, minimum: 200, maximum: 299 }
      payload: {}

  WireFailure:
    type: object
    required: [ok, error]
    properties:
      ok: { type: boolean, const: false }
      error: { $ref: "#/schemas/WireError" }

  WireEnvelope:
    oneOf:
      - { $ref: "#/schemas/WireSuccess" }
      - { $ref: "#/schemas/WireFailure" }

executionPolicy:
  gateOrder:
    - globalCapabilityGate
    - operationDescriptorGate
    - execute
  onGateDeny:
    resultKind: error
    mustRecordExecution: true
  binaryInputPolicy:
    rule: "Do not auto-render file pickers in v1."
    behavior:
      - "Render `format: binary` fields in JSON fallback mode."
      - "Surface explicit note: binary upload is not supported yet in dev sidebar v1."
      - "Allow manual payload editing in raw JSON mode only."

interfaces:
  ProtocolClientAdapter:
    methods:
      - name: listTools
        request:
          scope: SidebarScope
          params: ListCursorParams?
        response: WireEnvelope<PaginatedPayload>
      - name: callTool
        request:
          scope: SidebarScope
          params: ToolCallParams
        response: WireEnvelope<unknown>
      - name: listResources
        request:
          scope: SidebarScope
          params: ListCursorParams?
        response: WireEnvelope<PaginatedPayload>
      - name: readResource
        request:
          scope: SidebarScope
          params: ResourceUriParams
        response: WireEnvelope<unknown>
      - name: listResourceTemplates
        request:
          scope: SidebarScope
          params: ListCursorParams?
        response: WireEnvelope<PaginatedPayload>
      - name: subscribeResource
        request:
          scope: SidebarScope
          params: ResourceUriParams
        response: WireEnvelope<unknown>
      - name: unsubscribeResource
        request:
          scope: SidebarScope
          params: ResourceUriParams
        response: WireEnvelope<unknown>
      - name: listPrompts
        request:
          scope: SidebarScope
          params: ListCursorParams?
        response: WireEnvelope<PaginatedPayload>
      - name: getPrompt
        request:
          scope: SidebarScope
          params: PromptGetParams
        response: WireEnvelope<unknown>
      - name: complete
        request:
          scope: SidebarScope
          params: CompletionCompleteParams
        response: WireEnvelope<unknown>
      - name: getCapabilities
        request:
          scope: SidebarScope
        response: WireEnvelope<Record<string, unknown> | null>
      - name: getState
        request:
          scope:
            type: object
            required: [roomdUrl, roomId]
        response: WireEnvelope<Record<string, unknown>>

  CapabilityGate:
    signature:
      context:
        type: object
        required: [scope, protocol, now]
      operationId: OperationId
      input: unknown
    response: CapabilityGateResult

  SchemaAdapter:
    requiredFields: [id, canAdapt, adapt]
    methods:
      canAdapt:
        request:
          schema: unknown
        response: boolean
      adapt:
        request:
          schema: unknown
          context:
            type: object
            required: [operationId]
            properties:
              operationId: OperationId
        response: FormPlan

  OperationDescriptor:
    requiredFields: [id, tab, label, description, getInputSchema, canRun, execute]
    fieldSchema:
      id: OperationId
      tab: DevSidebarTabId
      label: string
      description: string
    methods:
      getInputSchema:
        request:
          context: ExecutionContext
        response: unknown
      canRun:
        request:
          context: ExecutionContext
          input: unknown
        response: CapabilityGateResult
      execute:
        request:
          context: ExecutionContext
          input: unknown
        response: unknown

  ResultRenderer:
    requiredFields: [id, supports, renderModel]
    methods:
      supports:
        request:
          result: NormalizedResult
        response: boolean
      renderModel:
        request:
          result: NormalizedResult
          context:
            type: object
            required: [operationId]
            properties:
              operationId: OperationId
        response: unknown

  DevSidebarConfig:
    requiredFields:
      - defaults
      - features
      - capabilityGate
      - operations
      - schemaAdapters
      - resultRenderers
    properties:
      defaults: DevSidebarDefaults
      features: DevSidebarFeatures
      capabilityGate: CapabilityGate
      operations: OperationDescriptor[]
      schemaAdapters: SchemaAdapter[]
      resultRenderers: ResultRenderer[]
```

## Touchpoints (Exact)
```yaml
touchpoints:
  contracts:
    - path: apps/host-web/src/dev-sidebar/contracts.ts
      responsibility: "Type contract authority for descriptors, adapters, and config"
    - path: apps/host-web/src/dev-sidebar/default-config.ts
      responsibility: "Single composition root registration point"
    - path: apps/host-web/src/dev-sidebar/README.md
      responsibility: "Boundary policy for this module"

  hostIntegration:
    - path: apps/host-web/src/room-canvas.tsx
      responsibility: "Room state subscription and instance-level operation wiring"
      endpoints:
        - GET /rooms/:roomId/state
        - GET /rooms/:roomId/events
        - POST /rooms/:roomId/instances/:instanceId/tools/call
        - POST /rooms/:roomId/instances/:instanceId/resources/list
        - POST /rooms/:roomId/instances/:instanceId/resources/read
        - POST /rooms/:roomId/instances/:instanceId/resources/templates/list
        - GET /rooms/:roomId/instances/:instanceId/capabilities
    - path: apps/host-web/src/implementation.ts
      responsibility: "MCP Apps bridge and sandbox boundary (must remain separate)"

  roomdServer:
    - path: services/roomd/src/server.ts
      responsibility: "HTTP server lifecycle and route registration"
    - path: services/roomd/src/server-instance-routes.ts
      responsibility: "Mounted instance MCP passthrough endpoints"
      endpoints:
        - GET /rooms/:roomId/instances/:instanceId/ui
        - GET /rooms/:roomId/instances/:instanceId/capabilities
        - GET /rooms/:roomId/instances/:instanceId/client-capabilities
        - PUT /rooms/:roomId/instances/:instanceId/client-capabilities/roots
        - PATCH /rooms/:roomId/instances/:instanceId/client-capabilities/sampling
        - PATCH /rooms/:roomId/instances/:instanceId/client-capabilities/elicitation
        - POST /rooms/:roomId/instances/:instanceId/client-capabilities/sampling/preview
        - POST /rooms/:roomId/instances/:instanceId/client-capabilities/elicitation/preview
        - POST /rooms/:roomId/instances/:instanceId/tools/list
        - POST /rooms/:roomId/instances/:instanceId/tools/call
        - POST /rooms/:roomId/instances/:instanceId/resources/list
        - POST /rooms/:roomId/instances/:instanceId/resources/read
        - POST /rooms/:roomId/instances/:instanceId/resources/templates/list
        - POST /rooms/:roomId/instances/:instanceId/prompts/list
        - POST /rooms/:roomId/instances/:instanceId/prompts/get
        - POST /rooms/:roomId/instances/:instanceId/completion/complete
        - POST /rooms/:roomId/instances/:instanceId/resources/subscribe
        - POST /rooms/:roomId/instances/:instanceId/resources/unsubscribe
```

## Non-Negotiable Rules
- No direct network calls from dev sidebar presentational components.
- All operation execution must route through `ProtocolClientAdapter`.
- All run authorization must route through `CapabilityGate` and descriptor `canRun`.
- Raw JSON fallback input is required for every operation.
- `default-config.ts` is the only file where operations/adapters/renderers are registered.

## Add-Without-Refactor Protocol
1. Add new `OperationId` in `contracts.ts`.
2. Implement new `OperationDescriptor` in a new module.
3. Register descriptor in `default-config.ts`.
4. Add or register schema adapter only if needed for new schema shape.
5. Add contract tests proving no shared execution component changes were required.

## Acceptance Criteria
- The YAML contract in this ADR matches `contracts.ts` one-to-one.
- Touchpoint paths and route names are explicit and current.
- Adding `resources.read` after `tools.call` requires only registration and tests, not shared-flow edits.
- Repo guard, architecture lint, and docs checks remain green.

## Risks And Mitigations
- Risk: schema variability breaks generated forms.
  - Mitigation: strict adapter boundary + mandatory raw JSON fallback.
- Risk: descriptor sprawl.
  - Mitigation: registration conventions and descriptor contract tests.
- Risk: crowded dev UX.
  - Mitigation: fixed panel IA and progressive disclosure defaults.

## Open Questions
None
