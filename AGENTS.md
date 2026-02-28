# Overview

mcp-app-room (`@mcp-app-room`) extends (`@modelcontextprotocol/ext-apps`), which enables MCP servers to display interactive UIs in conversational clients, to enable "views/rooms" (roomd) that host multiple app instances in a shared layout, with cross-instance interactions and room-level tools. While a bookmark on a web page is a single page, a room is a persistent container for multiple apps, like a virtual desktop or dashboard. This allows users to organize related apps together, share them with others, and create more complex interactions across apps in the same room. A room may not have a UI, which we also support as a headless mount of tools.

`@modelcontextprotocol/ext-apps` Key abstractions:

- **View** - UI running in an iframe, uses `App` class with `PostMessageTransport` to communicate with host
- **Host** - Chat client embedding the iframe, uses `AppBridge` class to proxy MCP requests
- **Server** - MCP server that registers tools/resources with UI metadata

`@mcp-app-room` adds:
- **Room** - Persistent container for multiple app instances, with layout and shared tools
- **Instance** - An app mounted in a room, linked to a specific tool and UI
- **Layout** - Defines how instances are arranged in the room (e.g. grid, tabs)
- **Room-level tools** - Tools that operate at the room level, not tied to a specific instance, where we simplyfy MCP communcation via a roomctl CLI and roomd server.
- **Cross-instance interactions** - Tools can reference other instances in the same room safely via the user, without the implementation details leaking between them.

## IMPORTANT:

- **MOST IMPORTANT:** Please do the right thing. It might hard, it might go against your goal, but please do the right thing. If you don't know what the right thing is, ask! I'm here to help, but I can't if you don't ask.
- **IMPORTANT**: This library utilizes @modelcontextprotol libraries and is a feature built on top of it. We must stay in line with their system and tooling, we cannot deviate.
- **IMPORTANT:** Refactor often! Don't be afraid to change code. In fact, that's what we want! Repositories bloat quickly, if you see an opportunity to refactor, do it now, because later will be 100x harder.
- If you disagree with what the user asks, push back!
- Run `npm run arch` to stream Mermaid diagrams (deps + types + callgraph) with no file writes. Use `--deps`, `--types`, or `--callgraph` to stream a single graph.
- Get todays date and time if you haven't today, because AI changes fast and looking at old documentation from 2025, when it's February 2026 (time of writing) is not okay, ever.
- If you leave stale documentation, you're fired. (obviously not, we just care about the right thing and hope you do to)
- No one cares if the build is green, that's a smoke test, it doesn't mean your code is good.
- You are not a task monkey, you are a principal engineer, you operate at principal engineer level, do you understand what that means?
- You have freedom, with freedom comes responsibility, you're basically spiderman, but a better dev.
- See something weird in code ALWAYS WRITE A TODO OR GOTCHA COMMENT.
- When creating backlog issues using the gh cli, you can add a label string by domain/team who you believe should handle it. This will make it clear to the team.
- Fix CI issues permanently please, dig into them, they might be a bigger deal than it looks.
- Use the GH cli tool. Never leave a dangling branch. Never leave a PR open. Merge it, resolve conflicts, install dependencies, fix issues.


### General Best Practices

### Git
- We're on a shared jumpbox.
- Never lock main.
- Do active work on a named branch (not detached).
- Run git fetch origin + git status -sb before starting a ticket.
- After merges, explicitly sync both the main worktree and any detached audit worktrees.

### Commands
- `npm run arch` # streams architecture Mermaid graphs to stdout (all by default; `--deps|--types|--callgraph` for one).
- `npm run arch:gen`  # explicitly regenerates docs/generated/... artifacts when file-based outputs are required.
- `npm run test:all` # runs all tests, including unit and integration. Use this before pushing to make sure everything is good.

### Apps-SDK Entry Points

- `@modelcontextprotocol/ext-apps` - Main SDK for Apps (`App` class, `PostMessageTransport`)
- `@modelcontextprotocol/ext-apps/react` - React hooks (`useApp`, `useHostStyleVariables`, etc.)
- `@modelcontextprotocol/ext-apps/app-bridge` - SDK for hosts (`AppBridge` class)
- `@modelcontextprotocol/ext-apps/server` - Server helpers (`registerAppTool`, `registerAppResource`)

### What makes a good repository?

A good repository optimizes for change over time, not just current correctness.

At principal level, I'd use this bar:

1.  Clear boundaries
    - Code is organized by domain/responsibility, not random technical layers.
    - Interfaces are explicit; coupling is intentional.
2.  Fast comprehension
    - A new engineer can open 1-2 files and understand system purpose and flow.
    - Naming is precise and boringly clear.
3.  Reliable contracts
    - Inputs/outputs are validated.
    - Invariants fail fast with useful errors.
4.  Evolvable structure
    - No god files.
    - Modules are small enough to reason about and replace.
5.  Operational readiness
    - Deterministic config loading.
    - Structured logs, health checks, graceful shutdown, predictable behavior under failure.
6.  Testing that protects refactors
    - Tests target behavior/contracts, not implementation trivia.
    - Critical paths and edge cases are covered.
7.  Documentation that stays true
    - Each domain explains Overview, End State, and Input/Output contract.
    - Docs reflect actual system boundaries and are maintained with code changes.
8.  Tooling discipline
    - Reproducible build/test/lint workflows.
    - Dependency graph and architecture checks catch drift early.
9.  One command to test. make test / npm test / go test ./... is documented and reliable.
10. One command to build/run. make build / make dev (or equivalents) exist and don’t require tribal knowledge.
11. Automate quality checks. Formatting, linting, type-checking, and tests are scriptable and consistent
12. Enforce checks in CI. The default branch is protected; CI is the referee, not “please remember.”
13. Use a consistent directory layout. A predictable home for src/, tests/, docs/, scripts/, etc.

If a repo makes safe change easy, fast, and obvious, it's good.
