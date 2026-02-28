# Architecture Linting (Target-State Governance)

This repository enforces architecture as code with `dependency-cruiser`.

Related docs:

- `docs/README.md`
- `docs/repository-setup.md`
- `docs/generated/README.md`

Configuration files:

- `.dependency-cruiser.base.cjs`: universal baseline rules for TS repos.
- `.dependency-cruiser.cjs`: repository-specific target-state layering rules.
- `.dependency-cruiser-known-violations.json`: temporary baseline for existing drift.

## 9-Point Governance Contract

1. No dependency cycles in production source.
2. Production source cannot import test code or test fixtures.
3. Production source cannot import generated build artifacts.
4. Production source cannot depend on runtime `devDependencies` (type-only exception allowed).
5. App source cannot import service implementation source (including transitive reachability).
6. Service source cannot import app implementation source (including transitive reachability).
7. `roomd` foundation modules (`types`, `schema`, `hash`) cannot reach runtime/integration modules.
8. `roomd` domain module (`store`) cannot reach adapter module (`mcp`) transitively.
9. `@modelcontextprotocol` SDK imports are boundary-only:
   - `services/roomd`: allowed in `mcp.ts` and `server.ts`
   - `apps/host-web`: allowed in `implementation.ts` and `sandbox.ts`

Rules 7-9 are intentional target-state constraints. They are stricter than current code and represent where the design is headed.

## Commands

```bash
npm run arch:lint          # CI-safe mode (fails only on violations not in known-baseline)
npm run arch:lint:strict   # strict mode (all violations)
npm run arch:baseline      # refresh known-violations baseline
npm run arch:deps:mermaid  # regenerate docs/generated/deps.mmd
npm run arch:gen           # generate full architecture docs in docs/generated/
npm run arch:check         # fail when generated architecture artifacts drift
```

## CI Mode and Exception Policy

- CI runs `arch:lint` with `--ignore-known` to block new violations while existing drift is paid down.
- Exceptions are managed by baseline entries, not by deleting rules.
- Every baseline refresh should be paired with explicit review in PR description:
  - Why each new exception is needed now
  - Removal condition / follow-up ticket
  - Expected removal date

## Current Baseline Debt

Current baseline contains 0 violations (`[]`).
