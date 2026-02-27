# Architecture Generation Summary

## Scope
- tsconfig: `./tsconfig.arch.json`
- includeOnly: `^(apps|services)/[^/]+/src/`
- exclude: `(^|/)node_modules/ | (^|/)(dist|build|coverage|out|\.next|\.turbo)(/|$) | (^|/)(test|tests|__tests__|__mocks__|fixtures|e2e)(/|$) | [.](spec|test)\.[cm]?[jt]sx?$ | [.]d[.]ts$ | (^|/)generated(/|$)`
- entrypoints: `apps/*/src/index.ts, apps/*/src/index.tsx, services/*/src/server.ts, services/*/src/cli.ts, services/*/src/workers/**/*.ts`

## Counts
- files scanned: 12
- type nodes: 32
- type edges: 8
- callable declarations discovered: 94
- callgraph entrypoints resolved: 2
- callgraph nodes: 56
- callgraph edges: 126 (truncated by maxEdges)
- unresolved callsites: 198

## Build Metadata
- commit: `8a7f08131088b023b375fefecbeccbe723b82ff3`
- timestamp: `2026-02-26T21:42:43-05:00`

## Tool Versions
- node: `v24.10.0`
- dependency-cruiser: `^17.3.8`
- ts-morph: `27.0.2`
- typescript: `5.9.3`
- @mermaid-js/mermaid-cli: `not-installed`

## Generated Artifacts
- deps.mmd
- types.mmd
- callgraph-app.txt
- callgraph.mmd
