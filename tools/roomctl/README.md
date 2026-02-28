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
```
