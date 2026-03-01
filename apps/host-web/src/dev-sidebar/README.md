# host-web/src/dev-sidebar

Contract-first boundary for a protocol-fidelity developer sidebar.

## Purpose

- Define stable interfaces for MCP operation execution without coupling to React UI details.
- Keep a single composition-root config for feature flags and registry wiring.
- Enable registration-based growth (operations/adapters/renderers) without refactoring shared components.

## Boundaries

- No direct network calls here; runtime operations must go through a protocol client adapter.
- No MCP SDK imports in this directory; SDK boundaries stay in `implementation.ts` and host integration modules.
- Keep this folder focused on contracts and configuration until runtime implementation is added.

## Files

- `contracts.ts`: shared type contracts for descriptors, adapters, result renderers, and execution records.
- `default-config.ts`: single composition-root config and safe defaults.
- `protocol-client.ts`: roomd HTTP adapter implementing `ProtocolClientAdapter`.
- `operations.ts`: default operation descriptor registry.
- `gates.ts`: capability gating policy.
- `schema-adapters.ts`: schema-to-form adapter registry and fallback strategy.
- `result-renderers.ts`: result rendering adapters.
- `engine.ts`: shared execution pipeline (`global gate -> descriptor gate -> execute -> normalize`).
- `dev-sidebar.tsx`: UI shell for the developer sidebar.
- `utils.ts`: shared parsing/coercion helpers used across adapters/descriptors/client.
