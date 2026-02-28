# Architecture Generator

Architecture generation is driven by:

- `tools/arch/arch.config.json`
- `tools/arch/generate.mjs`
- `scripts/generate-arch.sh`

Run from repo root:

```bash
npm run arch:gen
```

This writes artifacts to `docs/generated/` by default.

Generated files:

- `deps.mmd`
- `types.mmd`
- `callgraph-app.txt`
- `callgraph.mmd`

`SUMMARY.md` is intentionally not generated.

Check for drift:

```bash
npm run arch:check
```

Render optional SVG output:

```bash
npm run arch:render
```
