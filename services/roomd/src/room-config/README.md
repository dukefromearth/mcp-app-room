# room-config

Room configuration domain for `roomd`.

## Overview

- Defines the stable contract for reusable room presets (`types.ts`).
- Declares the persistence boundary (`repository.ts`).
- Implements SQLite-backed persistence + explicit migrations (`sqlite-repository.ts`, `migrations.ts`).
- Orchestrates validation + planning/diff + preflight + load application into rooms (`service.ts`).
- Emits audit/metric telemetry through an injectable sink (`telemetry.ts`).

## Boundaries

- This module persists and retrieves configuration intent only.
- Runtime session state, invocations, and lifecycle state remain in `RoomStore`.
- Load execution reuses existing room commands (`mount`, `hide`, `select`) through `RoomStore`.

## Contract Notes

- Current schema version: `room-config.v1`.
- Current load mode: `empty_only` (safe default).
- Namespace default is `default` when callers omit it.
