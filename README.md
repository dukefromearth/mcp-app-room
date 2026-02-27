# MCP App Room

Room-first MCP host stack:

- `apps/host-web` in room canvas mode (first-class)
- `services/roomd` room control plane
- CDP-attached Playwright shell (`npm run playwright`)

## Repo Layout

```text
apps/
  host-web/
services/
  roomd/
tools/
  roomctl/
e2e/
  playwright/
```

## Start

```bash
npm install
npm run start
```

This starts:

- Host: `http://localhost:8080`
- Sandbox: `http://localhost:8081`
- roomd: `http://localhost:8090`

Open:

- `http://localhost:8080/?mode=room&roomd=http://localhost:8090&room=demo`

## CLI

Quick guide: [`CLI_QUICK_START.md`](CLI_QUICK_START.md)

```bash
npm run roomd:cli -- create --room demo
npm run roomd:cli -- mount --room demo --instance inst-1 --server http://localhost:3001/mcp --tool get-time --container 0,0,4,4 --input '{}'
npm run roomd:cli -- call --room demo --instance inst-1 --input '{}'
npm run roomd:cli -- select --room demo --instance inst-1
npm run roomd:cli -- reorder --room demo --order inst-2,inst-1
npm run roomd:cli -- layout --room demo --ops '[{"op":"swap","first":"inst-1","second":"inst-2"}]'
```

Global flags:
- `--base-url` (default `http://localhost:8090`, env `ROOMD_BASE_URL`)
- `--timeout` (default `10s`)
- `--output pretty|json`

## Playwright Attached Mode

```bash
npm run playwright
```

By default this attaches to `http://127.0.0.1:9222`.

## Architecture Linting

Architecture constraints are enforced with `dependency-cruiser`.

```bash
npm run arch:lint
```

Full policy, target-state rules, and baseline process are documented in
[`docs/architecture-linting.md`](docs/architecture-linting.md).

## Architecture Diagrams

Compiler-backed architecture artifacts (dependency graph, type diagram, call graph)
are generated to `docs/generated/`.

```bash
npm run arch:gen
npm run arch:check
```
