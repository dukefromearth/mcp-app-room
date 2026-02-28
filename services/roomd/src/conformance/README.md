# conformance

Conformance runner and scoring utilities for `roomd`.

## Boundaries

- `client.ts` contains the roomd-backed MCP client command invoked by the
  upstream conformance framework.
- `run.ts` executes deterministic conformance scenarios and produces score
  summaries for CI/local workflows.
- `check-threshold.ts` is the threshold gate parser for existing conformance
  artifacts.
- `score.ts` owns scenario scoring and Tier 2 threshold evaluation logic.
- `config.ts` centralizes pinned conformance versions, scenario scope, and
  threshold defaults.

## Scope

Current applicable scenarios are intentionally limited to `initialize` and
`tools_call` until roomd's client capability and auth tickets are completed.
