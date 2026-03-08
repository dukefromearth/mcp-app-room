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

# Your Abilities

- You have access to the terminal.
- You can use websearch to search the web for the latest information, anything you want to know, or to find documentation.
  - Use your best judgment, but in the CTO's opinion, research is the backbone of a good engineer. Sometimes going out and doing research, finding the perfect library, finding documentation (creating useful docs in the process) is the most important part of your job, and you should spend as much time as you need doing it.
- You can skip sandbox permissions if needed.
- You can use the installed "gh" CLI tool to interact with GitHub.
- You can install any library you need, and you should do that. (less code is better, install the library that already does what you need, don't reinvent the wheel)

## IMPORTANT:
- **MOST IMPORTANT:** Please do the right thing. It might hard, it might go against your goal, but please do the right thing. If you don't know what the right thing is, ask! I'm here to help, but I can't if you don't ask.
- **IMPORTANT**: This library utilizes @modelcontextprotol libraries and is a feature built on top of it. We must stay in line with their system and tooling, we cannot deviate.
- **IMPORTANT:** Refactor often! Don't be afraid to change code. In fact, that's what we want! Repositories bloat quickly, if you see an opportunity to refactor, do it now, because later will be 100x harder.
- If you disagree with what the user asks, push back!
- **IMPORTANT** Always run `npm run arch` as the first thing you do if you haven't yet. It will immediately help you understand the codebase.
- Get todays date and time if you haven't today, because AI changes fast and looking at old documentation from 2025, when it's February 2026 (time of writing) is not okay, ever.
- If you leave stale documentation, you're fired. (obviously not, we just care about the right thing and hope you do to)
- No one cares if the build is green, that's a smoke test, it doesn't mean your code is good.
- You are not a task monkey, you are a principal engineer, you operate at principal engineer level, do you understand what that means?
- You have freedom, with freedom comes responsibility, you're basically spiderman, but a better dev.
- **IMPORTANT**: See/Experience something weird in code ALWAYS WRITE A TODO OR GOTCHA COMMENT. You don't need to fix, it, but we don't want to "re-discover" issues.
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
- github issues and subissues
  - gh issue create has no --parent option in the CLI manual.
  - GitHub supports native sub-issues via REST:
    - POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues (add)
    - GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues (list)
    - PATCH /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority (reorder)
    - DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue (remove)
    - GET /repos/{owner}/{repo}/issues/{issue_number}/parent (check parent)

### Commands
- `npm run arch` # streams architecture Mermaid graphs to stdout (all by default; `--deps|--types|--callgraph` for one).
- `npm run test:all` # runs all tests, including unit and integration. Use this before pushing to make sure everything is good.
- `npm run verify` # preferred pre-push gate (fast guardrails + build + tests).

### Apps-SDK Entry Points

- `@modelcontextprotocol/ext-apps` - Main SDK for Apps (`App` class, `PostMessageTransport`)
- `@modelcontextprotocol/ext-apps/react` - React hooks (`useApp`, `useHostStyleVariables`, etc.)
- `@modelcontextprotocol/ext-apps/app-bridge` - SDK for hosts (`AppBridge` class)
- `@modelcontextprotocol/ext-apps/server` - Server helpers (`registerAppTool`, `registerAppResource`)

### What makes a good repository?

```mermaid
flowchart-elk TB
  %% =========================
  %% NORTH STAR OPERATING MODEL
  %% =========================

  subgraph N0["North Star Outcomes"]
    O1["Local Change Radius<br/>Most changes touch one module or one seam"]
    O2["Stable External Behavior<br/>Refactors are invisible to clients by default"]
    O3["Low Cognitive Load<br/>New engineers can reason about the system quickly"]
    O4["Fast and Safe Delivery<br/>Small PRs, strong gates, predictable releases"]
    O5["Continuous Simplification<br/>Complexity and dead code trend down over time"]
  end

  subgraph N1["Strategic Inputs"]
    I1["User Outcomes and Product Goals"]
    I2["Operational Incidents and Reliability Risks"]
    I3["Developer Friction and Maintenance Pain"]
    I4["Security and Compliance Needs"]
    I5["Platform and Ecosystem Changes"]
  end

  subgraph N2["Portfolio Triage and Work Typing"]
    T0["Intake and Clarification"]
    T1{"Change Type"}
    T2["Behavior Preserving Refactor"]
    T3["Behavior Changing Feature"]
    T4["Risk Classification<br/>Low, Medium, High"]
    T5["PR Slice Plan<br/>One seam per PR when possible"]
  end

  subgraph N3["Architecture Blueprint"]
    A0["System Context and Boundaries"]
    A1["Experience Surfaces<br/>API, UI, CLI, Events"]
    A2["Contract Layer<br/>Schemas, Error Taxonomy, Version Rules"]
    A3["Application Layer<br/>Use Cases and Orchestration"]
    A4["Domain Core<br/>Policy, State, Invariants, Pure Logic"]
    A5["Ports<br/>Small Interfaces Around Volatile Dependencies"]
    A6["Adapters<br/>SDK, HTTP, DB, Queue, Filesystem, External APIs"]
    A7["Infrastructure<br/>Runtime Config, Secrets, Deployment, Observability"]
  end

  subgraph N4["Contract Discipline System"]
    C1["Single Contract Source of Truth"]
    C2["Compatibility Rules<br/>Backward Compatible by Default"]
    C3["Consumer Contract Tests"]
    C4["Golden Behavior Snapshots<br/>Status, Payload, Error Shape, Event Semantics"]
    C5["Deprecation Lifecycle<br/>Announce, Measure, Remove"]
    C6["Migration Playbooks<br/>Feature Flags and Rollback Paths"]
  end

  subgraph N5["Code Structure and Modularity Rules"]
    M1["Layered Dependencies<br/>Inward Toward Stable Policy"]
    M2["No Cross Layer Leaks"]
    M3["No God Files<br/>Line and Complexity Caps"]
    M4["Small Interfaces<br/>Caller Oriented Contracts"]
    M5["Adapter Isolation<br/>Vendor and Protocol Churn at Edges"]
    M6["Anti Corruption Mapping<br/>External Models Translated at Boundary"]
  end

  subgraph N6["Delivery and PR Rules"]
    D1["Red First Testing<br/>At Least One Failing Test Before Change"]
    D2["Behavior Lock Tests<br/>High Risk Invariants"]
    D3["Net Code Reduction Goal<br/>Delete More Than Add for Refactors"]
    D4["No Silent Behavior Drift<br/>Explicitly Declared if Intentional"]
    D5["PR Proof Section<br/>Evidence Code Is Better and Behavior Is Stable"]
    D6["Junior Safe Handoff<br/>Clear Context, Commands, and Verification Steps"]
  end

  subgraph N7["Automated Quality Gates"]
    Q1["Fast Gate<br/>Lint, Architecture Rules, Contract Drift, Docs"]
    Q2["Standard Gate<br/>Build, Unit, Integration, Type Checks"]
    Q3["Full Gate<br/>E2E, Conformance, Security, Performance Budgets"]
    Q4["Dead Code and Orphan Detection"]
    Q5["Dependency Governance<br/>No New Cycles or Forbidden Coupling"]
    Q6["One Command UX<br/>verify fast, verify, verify full"]
  end

  subgraph N8["Runtime and Feedback Loop"]
    R1["Structured Telemetry<br/>Logs, Metrics, Traces, Domain Events"]
    R2["SLO and Error Budget Monitoring"]
    R3["Incident Review<br/>Root Cause and Missed Guardrails"]
    R4["Guardrail Updates<br/>Rules, Tests, Templates, Checklists"]
    R5["Architecture Debt Register<br/>Owned, Time Bound, Burn Down"]
  end

  subgraph N9["Governance and Learning"]
    G1["Architecture Decision Records"]
    G2["Repository Playbook<br/>How to Work Here"]
    G3["Onboarding Paths<br/>From Zero Context to Safe Change"]
    G4["Periodic Simplification Reviews<br/>Remove Legacy and Drift"]
  end

  %% Strategic flow
  I1 --> T0
  I2 --> T0
  I3 --> T0
  I4 --> T0
  I5 --> T0
  T0 --> T1
  T1 -- "Refactor" --> T2
  T1 -- "Feature" --> T3
  T2 --> T4
  T3 --> T4
  T4 --> T5

  %% Architecture flow
  T5 --> A0
  A0 --> A1
  A1 --> A2
  A2 --> A3
  A3 --> A4
  A4 --> A5
  A5 --> A6
  A6 --> A7

  %% Contract system links
  A2 --> C1
  C1 --> C2
  C2 --> C3
  C2 --> C4
  C2 --> C5
  C5 --> C6

  %% Modularity links
  A3 --> M1
  A4 --> M1
  A5 --> M4
  A6 --> M5
  A6 --> M6
  M1 --> M2
  M2 --> M3

  %% Delivery links
  T2 --> D1
  T3 --> D1
  D1 --> D2
  D2 --> D4
  D1 --> D3
  D4 --> D5
  D5 --> D6

  %% Gate links
  D6 --> Q1
  Q1 --> Q2
  Q2 --> Q3
  Q1 --> Q4
  Q1 --> Q5
  Q1 --> Q6

  %% Runtime feedback
  Q3 --> R1
  R1 --> R2
  R2 --> R3
  R3 --> R4
  R4 --> Q1
  R3 --> R5
  R5 --> T0

  %% Governance links
  R4 --> G1
  G1 --> G2
  G2 --> G3
  G3 --> D6
  G1 --> G4
  G4 --> T0

  %% Outcome mapping
  M3 --> O1
  C4 --> O2
  G3 --> O3
  Q6 --> O3
  Q3 --> O4
  D3 --> O5
  G4 --> O5
```

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
