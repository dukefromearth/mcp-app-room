# Repository Setup Guardrails

This repository optimizes for safe change at scale by enforcing target-state setup rules locally before code lands.

Related docs:

- `docs/README.md`
- `docs/architecture-linting.md`
- `tools/repo-guard/README.md`

## Commands

```bash
npm run repo:doctor        # explain local environment/workspace install state
npm run repo:guard         # block new repo setup anti-patterns
npm run repo:guard:strict  # show all current violations
npm run repo:guard:baseline
npm run setup:hooks        # optional pre-commit hook install
npm run verify:fast        # preferred fast local gate
npm run verify             # preferred pre-push gate
```

## Target-State Rules

1. No tracked OS junk or build artifacts (`.DS_Store`, `dist/`, `coverage/`, etc.).
2. No tracked `node_modules/**` paths anywhere in the repository.
3. Every source directory under `apps/*/src` and `services/*/src` must contain `README.md`.
4. Every top-level workspace (`apps/*`, `services/*`, `tools/*`) must contain `README.md`.
5. Workspace shape is validated (`apps/*` and `services/*` must contain `package.json`, `README.md`, and `src`).
6. Source file line cap is enforced to prevent new god files.

## npm Workspaces Note

Dependencies are hoisted to root `node_modules/` by default. It is normal for
`apps/*` or `services/*` directories to have no local `node_modules/`.

## Baseline Policy

- Rules are written for the target architecture and target repository shape.
- Existing debt can be temporarily captured in `.repo-guard-known-violations.json`.
- `repo:guard` fails only on violations not in baseline.
- `repo:guard:strict` fails on all violations and is used for debt burn-down.
- Baseline refreshes must be intentional and reviewed.

## Current Baseline Debt

- 5 `source-line-cap` violations are currently baseline-suppressed.
- To list all current debt: `npm run repo:guard:strict`.
