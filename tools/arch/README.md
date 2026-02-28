# Architecture Generator

Architecture generation is driven by:

- `tools/arch/arch.config.json`
- `tools/arch/generate.mjs`
- `scripts/generate-arch.sh`

Run from repo root:

```bash
npm run arch
```

`npm run arch` prints Mermaid output to stdout and writes no files.

Default output includes all graph families:

- dependency graph
- type graph
- call graph

Select exactly one graph family when needed:

```bash
npm run arch -- --deps
npm run arch -- --types
npm run arch -- --callgraph
```

Use file-based generation only when you explicitly need `docs/generated/` artifacts:

```bash
npm run arch:gen
```

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
