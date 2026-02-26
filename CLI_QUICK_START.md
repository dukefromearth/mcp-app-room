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

Useful shell commands:
- `list`
- `use <index>`
- `goto <url>`
- `click <selector>`
- `fill <selector> <text>`
- `type <selector> <text>`
- `press <key>`
- `screenshot [file]`

Example URL to open in shell:

```text
http://localhost:8080/?mode=room&roomd=http://localhost:8090&room=demo
```

## 5) Practical Debug Notes

- If `create --room demo` returns `409`, the room already exists. Continue with `state`.
- If host startup fails with `EADDRINUSE`, free ports `8080/8081/8090` and restart.
- Keep one terminal for `npm run start` and another for CLI commands.
- Prefer `--output json` for machine-readable output when chaining tools.
