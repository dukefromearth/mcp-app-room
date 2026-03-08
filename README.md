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
- [docs/roomd-support-matrix.md](docs/roomd-support-matrix.md)
- [docs/roomd-deprecation-policy.md](docs/roomd-deprecation-policy.md)
- [docs/roomd-release-readiness-checklist.md](docs/roomd-release-readiness-checklist.md)

## Start

```bash
npm install
npm run dev
npm run host:open
```

Global runtime defaults are loaded from:

- `config/global.yaml`

Security behavior is profile-driven via `config/global.yaml`:

- `security.profile: local-dev` enables permissive local behavior
- `security.profile: strict` enforces restrictive defaults

`npm` scripts (`host:start`, `roomd:start`, `roomd:cli`, `host:open`) resolve
runtime wiring from `config/global.yaml` by default (or `MCP_APP_ROOM_CONFIG` when set).
Use explicit flags for overrides.

To run roomd in strict mode locally:

```bash
npm run roomd:start:strict
```

Open:

- Debug-only query overrides are still available with `?debug=1` (for e2e and diagnostics).

## CLI

```bash
npm run roomd:cli -- create --room demo
npm run roomd:cli -- inspect --server http://localhost:3001/mcp
npm run roomd:cli -- mount --room demo --instance inst-1 --server http://localhost:3001/mcp --container 0,0,4,4
npm run roomd:cli -- tools-list --room demo --instance inst-1
npm run roomd:cli -- tool-call --room demo --instance inst-1 --name get-time --arguments '{}'
npm run roomd:cli -- select --room demo --instance inst-1
npm run roomd:cli -- reorder --room demo --order inst-2,inst-1
npm run roomd:cli -- layout --room demo --ops '[{"op":"swap","first":"inst-1","second":"inst-2"}]'
npm run roomd:cli -- room-config-upsert --config banking-room --spec '{"schemaVersion":"room-config.v1","instances":[{"instanceId":"ledger","server":"http://localhost:3001/mcp","container":{"x":0,"y":0,"w":6,"h":4}}]}'
npm run roomd:cli -- room-config-plan --config banking-room --room demo
npm run roomd:cli -- room-config-load --config banking-room --room demo --idempotency-key cfg-load-1
npm run roomd:cli -- room-config-save --room demo --config banking-room
```

Global flags:
- `--config` (default: `config/global.yaml` via upward lookup)
- `--base-url` (overrides `roomd.baseUrl` from config)
- `--timeout` (default `10s`)
- `--output pretty|json`

## Developer Checks

```bash
npm run verify        # default pre-push command
```

## Real MCP Fixture

Canonical real MCP server fixture for integration tests:

```bash
npm run fixture:integration-server
```

Fixture source lives at `e2e/fixtures/integration-server`.

Run the canonical real-MCP integration suite:

```bash
npm run test:integration:real-mcp
```

Runbook:

- `docs/real-mcp-integration-testing.md`

## MCP Conformance (Tier 1 Gate)

Run deterministic MCP conformance checks and enforce the Tier 1 threshold:

```bash
npm run conformance:run
npm run conformance:check
npm run conformance:tier1
```

Current applicable required scenarios for `roomd`'s client boundary:

- `initialize`
- `tools_call`

Why only these two right now:

- `roomd` is a room control plane that consumes MCP servers; it is not a direct
  public MCP endpoint.
- Tier 1 scoring is computed against the currently applicable non-experimental
  required scenarios for this boundary.

Troubleshooting:

- Artifacts are written to `artifacts/conformance`.
- Override threshold for local gate validation:
  - `npm run conformance:check -- --threshold 1.1` (expected to fail)
- Override output directory:
  - `npm run conformance:run -- --output-dir ./artifacts/conformance-local`

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
