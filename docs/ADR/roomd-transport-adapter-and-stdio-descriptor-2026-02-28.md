# ADR: roomd Transport Adapter and stdio Descriptor (2026-02-28)

## Status
Accepted

## Context
`roomd` previously assumed HTTP/SSE URLs and embedded transport fallback logic directly
inside the MCP session factory. This made stdio support hard to add safely and made
server target validation inconsistent.

## Decision
Adopt a transport adapter boundary in `services/roomd/src/mcp.ts` and a canonical
server-target descriptor parser in `services/roomd/src/server-target.ts`.

### Descriptor contract
`server` remains a string for backwards compatibility. It now supports:

1. HTTP(S) URL descriptors (unchanged).
2. stdio descriptors in URL form:
   `stdio://spawn?command=<cmd>&arg=<arg>&arg=<arg>&cwd=<cwd>&env.KEY=value`

Rules:
- protocol must be `http:`, `https:`, or `stdio:`
- stdio descriptors require exactly one `command`
- stdio `arg` is repeatable
- stdio `cwd` is optional (max one)
- stdio env keys must use `env.<KEY>` with `KEY` matching `[A-Za-z_][A-Za-z0-9_]*`
- unknown stdio query keys are rejected

### Adapter model
`mcp.ts` now uses a `TransportAdapter` interface with concrete adapters:
- HTTP adapter (`streamable-http` then legacy SSE fallback)
- stdio adapter (`StdioClientTransport`)

`McpSessionFactory` now supports:
- `getSession(roomId, server)`
- `releaseSession(roomId, server)` for deterministic cleanup

## Security and lifecycle policy
- stdio command execution is controlled by `ROOMD_STDIO_COMMAND_ALLOWLIST`
- no allowlist entries means stdio is disabled by default
- `*` allows all commands
- final unmount releases the session and closes the transport
- inspection sessions are released immediately after inspection completes

## Consequences
Positive:
- clear transport boundary for future adapters
- stdio support with command/args/env/cwd descriptors
- deterministic subprocess cleanup path
- existing HTTP mount semantics remain compatible

Tradeoffs:
- stdio descriptor syntax is less ergonomic than object payloads
- allowlist must be configured explicitly for stdio in production

## Alternatives considered
- object-based `server` payload in mount command: rejected for now to preserve existing API shape
- ad hoc stdio logic directly in session factory: rejected due coupling and testability costs
