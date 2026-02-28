# client-capabilities

Client-side MCP capability adapters for `roomd` as an MCP client.

## Boundaries

- `roots.ts` handles roots configuration, normalization, and roots/list responses.
- `sampling.ts` evaluates sampling policy and returns deterministic allow/deny decisions.
- `elicitation.ts` evaluates elicitation mode/sensitivity policy and returns deterministic actions.
- `registry.ts` stores per-room/per-server capability config and exposes a single
  integration surface to `store.ts` and `mcp.ts`.

## Safety defaults

- Sampling is disabled by default and denied unless explicitly enabled.
- Elicitation is disabled by default and denied unless explicitly enabled.
- Sensitive form elicitation can be forced to URL-mode only.
