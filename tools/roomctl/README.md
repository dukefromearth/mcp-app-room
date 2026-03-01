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
npm run roomd:cli -- mount --room demo --instance inst-stdio --server "stdio://spawn?command=node&arg=/abs/server.mjs" --container 0,0,6,4
npm run roomd:cli -- prompts-get --room demo --instance inst-1 --name summarize --arguments '{"topic":"mcp"}'
npm run roomd:cli -- complete --room demo --instance inst-1 --params '{"ref":{"type":"ref/prompt","name":"summarize"},"argument":{"name":"topic","value":"mc"}}'
npm run roomd:cli -- resources-subscribe --room demo --instance inst-1 --uri file://notes.md
```

When `--output pretty` is used and a request fails, `roomctl` prints
`error [CODE]`, plus optional `hint` and `details` from roomd's typed error
contract.

`roomctl` also enriches JSON responses with a `body.suggestions` array:

- `cmd`: placeholder-only follow-up command (`{{room}}`, `{{instance}}`, `{{server}}`, etc.)
- `description`: brief explanation of why that command is the likely next step

Config resolution:

- `roomctl` reads `roomd.baseUrl` from `config/global.yaml` by default.
- Override config path with `--config /path/to/global.yaml`.
- Override URL directly with `--base-url http://host:port` (highest priority).
