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

## Documentation

- [docs/README.md](docs/README.md)
- [docs/architecture-linting.md](docs/architecture-linting.md)
- [docs/repository-setup.md](docs/repository-setup.md)
- [docs/generated/README.md](docs/generated/README.md)

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

Quick guide: [`docs/cli/CLI_QUICK_START.md`](docs/cli/CLI_QUICK_START.md)

```bash
npm run roomd:cli -- create --room demo
npm run roomd:cli -- inspect --server http://localhost:3001/mcp
npm run roomd:cli -- mount --room demo --instance inst-1 --server http://localhost:3001/mcp --container 0,0,4,4
npm run roomd:cli -- tools-list --room demo --instance inst-1
npm run roomd:cli -- tool-call --room demo --instance inst-1 --name get-time --arguments '{}'
npm run roomd:cli -- select --room demo --instance inst-1
npm run roomd:cli -- reorder --room demo --order inst-2,inst-1
npm run roomd:cli -- layout --room demo --ops '[{"op":"swap","first":"inst-1","second":"inst-2"}]'
```

Global flags:
- `--base-url` (default `http://localhost:8090`, env `ROOMD_BASE_URL`)
- `--timeout` (default `10s`)
- `--output pretty|json`

## Developer Checks

```bash
npm run check:dev
npm run test:all
```

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

Stream Mermaid graphs to stdout (no files written):

```bash
npm run arch                     # deps + types + callgraph (default)
npm run arch -- --deps           # deps only
npm run arch -- --types          # types only
npm run arch -- --callgraph      # callgraph only
```

File-based artifact regeneration still exists for checked-in docs:

```bash
npm run arch:gen
npm run arch:check
```

## Repository Guardrails

Local anti-pattern checks are enforced by `repo-guard`:

```bash
npm run repo:guard
npm run repo:guard:strict
npm run repo:guard:baseline
npm run repo:doctor
```

Full policy is documented in
[`docs/repository-setup.md`](docs/repository-setup.md).

Install local git hooks (optional but recommended):

```bash
npm run setup:hooks
```

## npm Workspace `node_modules`

This repo uses npm workspaces, so dependencies are hoisted into root
`node_modules/` by default. Not seeing `node_modules/` inside
`apps/host-web` or `services/roomd` is normal.
