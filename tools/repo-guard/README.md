# Repo Guard

`repo-guard` is a local anti-pattern scanner focused on repository setup and scalability hygiene.

It enforces target-state repository rules and supports baseline gating to block new drift while existing debt is removed.

## Commands

```bash
npm run repo:guard          # fail on new violations vs baseline
npm run repo:guard:strict   # fail on all violations
npm run repo:guard:baseline # refresh known-violations baseline
npm run repo:doctor         # explain local workspace/install state
```

## Rules

- No tracked OS/build artifacts (e.g., `.DS_Store`, `dist/`, `coverage/`).
- No tracked `node_modules/**` paths.
- Every directory under `apps/*/src` and `services/*/src` requires a `README.md`.
- Every top-level workspace (`apps/*`, `services/*`, `tools/*`) requires a `README.md`.
- Workspace shape checks enforce required entries by domain (`apps/*`, `services/*`, `tools/*`).
- Source file line cap to prevent god files.

Configuration lives in:

- `tools/repo-guard/repo-guard.config.json`
- `.repo-guard-known-violations.json`

Current baseline debt:

- 5 `source-line-cap` violations are currently suppressed in non-strict mode.
