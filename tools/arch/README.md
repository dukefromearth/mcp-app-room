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
  - run with `-- ` + `--deps`, `--types`, or `--callgraph` to select a single/multiple family.