# host-web/src/room-canvas

Internal room-canvas seams that isolate volatile runtime concerns:

- `contracts.ts`: room state/event and UI resource contracts used by the host.
- `roomd-client.ts`: roomd HTTP adapter for state, capabilities, and instance calls.
- `room-events.ts`: room subscription lifecycle (bootstrap snapshot + SSE stream).
- `bridge-wiring.ts`: app bridge handler wiring and host-theme propagation.
- `room-app-instance.tsx`: per-instance iframe/bootstrap lifecycle.
- `invocations.ts`: latest invocation selection policy.

These modules are host-internal and must preserve existing room canvas behavior.
