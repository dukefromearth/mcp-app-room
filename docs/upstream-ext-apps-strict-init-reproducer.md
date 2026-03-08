# Upstream ext-apps Strict-Mode Init Reproducer

This document captures the minimal local reproducer we use when reporting upstream `@modelcontextprotocol/ext-apps` strict-mode initialization issues (duplicate `ui/initialize` and follow-on `unknown message ID` errors).

## Scope

- Reproduce initialization churn at the host/app bridge boundary.
- Capture evidence artifacts that can be attached to an upstream issue/PR.
- Validate local hardening keeps room lifecycle truth stable even when upstream behavior is noisy.

## Prerequisites

- Node 22+
- Go 1.25+
- `npm ci`
- `npm run verify:fast`

## Reproducer Steps

1. Start the integration fixture server:

```bash
npm run fixture:integration-server
```

2. Start `roomd` and host from global config (canonical startup path):

```bash
npm run roomd:start
npm run host:start
```

3. Inspect and mount the integration fixture app with `roomctl`:

```bash
npm run roomd:cli -- inspect --server http://127.0.0.1:7777/mcp
npm run roomd:cli -- create --room demo
npm run roomd:cli -- mount --room demo --instance integration-1 --server http://127.0.0.1:7777/mcp --container 0,0,4,8 --ui-resource-uri ui://integration/get-time.html
```

4. Trigger init stress by refreshing host repeatedly (or by running the strict stress integration spec):

```bash
npm run test:integration:real-mcp
```

5. Inspect logs for duplicate init and unknown message-id signals:

```bash
rg -n "ui/initialize|unknown message ID" artifacts/real-mcp apps/host-web services/roomd
```

## Expected Local Behavior (with V2 hardening)

- `roomd` accepts one lifecycle progression per active session and treats exact duplicates idempotently.
- Stale mount/session lifecycle submissions are rejected with typed lifecycle errors.
- Host-side setup-generation guards prevent stale async setup paths from mutating active sessions.

## Upstream Tracking

- TODO: attach this reproducer and artifacts to upstream ext-apps PR for strict-mode-safe initialization idempotency.
- TODO: once upstream patch merges, pin this repo to the patched ext-apps version and update this document with the commit/release reference.
