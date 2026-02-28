# Generated Architecture Artifacts

Artifacts in this directory are generated from static analysis and should remain diff-friendly text.

## Files

- `deps.mmd`: module/file dependency graph (Mermaid).
- `types.mmd`: type/structure graph (Mermaid class diagram).
- `callgraph-app.txt`: call edges in text form (`caller -> callee`).
- `callgraph.mmd`: call graph in Mermaid flowchart form.

`SUMMARY.md` is intentionally not generated.

## Regeneration

```bash
npm run arch                     # stream all Mermaid graphs to stdout
npm run arch -- --deps           # stream dependency graph only
npm run arch -- --types          # stream type graph only
npm run arch -- --callgraph      # stream call graph only
npm run arch:gen
npm run arch:check
```

## Notes

- Call graph output is best-effort and may include unresolved/dynamic edges.
- Mermaid SVG rendering is optional and controlled via `npm run arch:render`.
