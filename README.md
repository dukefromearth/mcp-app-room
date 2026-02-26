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
