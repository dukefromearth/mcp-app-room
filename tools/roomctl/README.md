# roomctl

Go-based CLI for interacting with `roomd`.

Canonical CLI docs live at:

- `docs/cli/CLI_QUICK_START.md`

## Layout

- `cmd/roomctl`: binary entrypoint.
- `internal/roomctl/cli`: cobra command wiring.
- `internal/roomctl/parse`: argument parsing and coercion helpers.
- `internal/roomctl/roomd`: HTTP client wrapper for roomd API.

## Usage

```bash
npm run roomd:cli -- --help
npm run roomd:cli -- inspect --server http://localhost:3114/mcp
npm run roomd:cli -- mount --room demo --instance inst-1 --server http://localhost:3114/mcp --container 0,0,4,12
```
