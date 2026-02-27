# CLI Quick Start (roomctl + Playwright)

This guide is the fastest path to reproduce the flow we just ran:
- start services cleanly
- mount MCP apps into a room
- manipulate visibility/layout
- inspect state with concise `jq` output
- poke the UI with Playwright

## Prereqs

```bash
npm install
```

Optional but recommended:
- `jq` for readable/filtered JSON output
- `rg` (ripgrep) for fast text search in large payloads

## 1) Start Clean

If old processes are still listening on the app ports:

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8081 -sTCP:LISTEN
lsof -nP -iTCP:8090 -sTCP:LISTEN
```

Kill stale PIDs if needed:

```bash
kill <pid> <pid> <pid>
```

Start the stack:

```bash
npm run start
```

Health checks:

```bash
curl -sS http://localhost:8090/health
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8080
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8081
```

Open:

```text
http://localhost:8080/?mode=room&roomd=http://localhost:8090&room=demo
```

## 2) CLI Basics

Create room:

```bash
npm run roomd:cli -- create --room demo
```

Mount first MCP app:

```bash
npm run roomd:cli -- mount --room demo --instance inst-1 --server http://localhost:3101/mcp --tool get-time --container 0,0,4,4 --input '{}'
```

Hide/show:

```bash
npm run roomd:cli -- hide --room demo --instance inst-1
npm run roomd:cli -- show --room demo --instance inst-1
```

Add second app:

```bash
npm run roomd:cli -- mount --room demo --instance inst-2 --server http://localhost:3101/mcp --tool get-time --container 4,0,4,4 --input '{}'
```

Useful extras:

```bash
npm run roomd:cli -- call --room demo --instance inst-1 --input '{}'
npm run roomd:cli -- select --room demo --instance inst-2
npm run roomd:cli -- reorder --room demo --order inst-2,inst-1
npm run roomd:cli -- layout --room demo --ops '[{"op":"swap","first":"inst-1","second":"inst-2"}]'
```

Container/layout manipulation (transactional):

```bash
# Move one instance
npm run roomd:cli -- layout --room demo --ops '[{"op":"move","instanceId":"inst-1","dx":1,"dy":0}]'

# Set an exact container
npm run roomd:cli -- layout --room demo --ops '[{"op":"set","instanceId":"inst-1","container":{"x":0,"y":0,"w":6,"h":4}}]'

# Apply multiple operations atomically
npm run roomd:cli -- layout --room demo --ops '[{"op":"swap","first":"inst-1","second":"inst-2"},{"op":"bring-to-front","instanceId":"inst-1"}]'
```

## 3) `jq` Tips (Use These A Lot)

Raw state can be noisy. Filter aggressively:

```bash
npm run roomd:cli -- state --room demo | jq '.body.state | {roomId, revision, selectedInstanceId, order}'
```

Show only mounts:

```bash
npm run roomd:cli -- state --room demo | jq '.body.state.mounts | map({instanceId, visible, toolName, server, container})'
```

Show invocation statuses:

```bash
npm run roomd:cli -- state --room demo | jq '.body.state.invocations | map({instanceId, invocationId, status})'
```

Extract mounted UI resource metadata without dumping huge HTML:

```bash
curl -sS http://localhost:8090/rooms/demo/instances/inst-1/ui | jq '.resource | {uiResourceUri, htmlLength: (.html | length)}'
```

Search inside the big HTML blob:

```bash
curl -sS http://localhost:8090/rooms/demo/instances/inst-1/ui \
  | jq -r '.resource.html' \
  | rg -n "This is message text\\.|BONK"
```

## 4) Playwright Flow

This repo includes an attached CDP shell:

```bash
npm run playwright
```

Core shell commands:
- `list`
- `use <index>`
- `goto <url>`
- `click <selector>`
- `fill <selector> <text>`
- `type <selector> <text>`
- `press <key>`
- `screenshot [file]`

Structured inspection command:
- `inspect <target> [options]`
- targets: `dom | globals | state | storage | network | console`
- options:
- `--selector <css>` (for `dom`)
- `--path <dot.path>` (for `globals`, `state`, `storage`)
- `--filter </pattern/flags|text>`
- `--context <n>` (for `dom`)
- `--max <n>`
- `--truncate <n>`
- `--format <json|table>`

Inspect examples:

```bash
# Find matching DOM text and show nearby sibling context
inspect dom --selector "[data-testid]" --filter "/error|timeout/i" --context 2 --max 20

# List globals at a path and filter keys
inspect globals --path "window" --filter "/app|store/i" --max 50

# Read app state snapshot (from window.__APP_STATE__)
inspect state --path "session.user" --truncate 800

# Read only session storage keys matching auth
inspect storage --path session --filter auth --max 25

# Review recent console and network telemetry
inspect console --filter "/warn|error/i" --max 30
inspect network --filter "/api|mcp/i" --max 30
```

Unsafe eval (disabled by default):
- `eval <js-expression>` is only available if:
- `PLAYWRIGHT_ALLOW_UNSAFE_EVAL=true npm run playwright`

Example URL to open in shell:

```text
http://localhost:8080/?mode=room&roomd=http://localhost:8090&room=demo
```

## 5) Practical Debug Notes

- If `create --room demo` returns `409`, the room already exists. Continue with `state`.
- If host startup fails with `EADDRINUSE`, free ports `8080/8081/8090` and restart.
- Keep one terminal for `npm run start` and another for CLI commands.
- Prefer `--output json` for machine-readable output when chaining tools.

## 6) App-Agnostic Command Dependency Flow

This section describes the logical order of CLI operations without assuming any
specific MCP app or tool names.

### A) Start with room-level truth

You can always run these first:

```bash
npm run roomd:cli -- health
npm run roomd:cli -- state --room <room-id> -o json
```

From `state`, capture:
- room identity/revision (`state.roomId`, `state.revision`)
- mounted instances (`state.mounts[*].instanceId`)
- currently selected instance (`state.selectedInstanceId`)
- prior invocations (`state.invocations[*]`)

### B) Instance-scoped commands require `instanceId`

Do not run instance commands until you have an `instanceId` from `state.mounts`:

```bash
npm run roomd:cli -- capabilities --room <room-id> --instance <instance-id> -o json
npm run roomd:cli -- resources-list --room <room-id> --instance <instance-id> -o json
npm run roomd:cli -- resource-templates-list --room <room-id> --instance <instance-id> -o json
npm run roomd:cli -- prompts-list --room <room-id> --instance <instance-id> -o json
```

Notes:
- `prompts-list` may return "method not found" if that server does not implement prompts.
- `resources-list` and `resource-templates-list` tell you what can be read next.

### C) Resource reads require a URI

Do not call `resources-read` until a valid URI has been discovered from
`resources-list` (or inferred from a template and concrete parameters):

```bash
npm run roomd:cli -- resources-read --room <room-id> --instance <instance-id> --uri <resource-uri> -o json
```

### D) Invocations and tool calls are sequential

If you invoke a mounted instance, you create a new invocation record:

```bash
npm run roomd:cli -- call --room <room-id> --instance <instance-id> --input '{}' -o json
```

Then re-read state to get the invocation metadata:

```bash
npm run roomd:cli -- state-get --room <room-id> --path state.invocations -o json
```

From invocation payloads, you may get app-defined identifiers (for example,
session or view identifiers). Those values are often required for subsequent,
app-specific tool calls.

### E) Direct tool calls require prior discovery

Use `tool-call` only after you know:
- `instanceId` (from mounts)
- tool name (from app docs/capabilities/conventions)
- required arguments (often from prior invocation outputs)

```bash
npm run roomd:cli -- tool-call --room <room-id> --instance <instance-id> --name <tool-name> --arguments '{"key":"value"}' -o json
```

### F) Safe “unknown app” triage order

When you know nothing about what is mounted, this order avoids dead ends:

1. `health`
2. `state`
3. pick an `instanceId` from `state.mounts`
4. `capabilities`
5. `resources-list`
6. `resource-templates-list`
7. optional `prompts-list`
8. `resources-read` for discovered URIs
9. `call` or `tool-call` only after required identifiers are known
10. `state-get state.invocations` to correlate outputs to invocation IDs
