# roomd Support Matrix

This document defines the v1 support contract for `roomd` against MCP core and
the Apps extension profile.

<!-- roomd-support-matrix:json:start -->
{
  "protocolSpecVersion": "2025-11-25",
  "conformanceTier": "tier1",
  "applicableRequiredScenarios": ["initialize", "tools_call"],
  "transports": {
    "streamable-http": "supported",
    "legacy-sse": "supported-deprecated",
    "stdio": "supported"
  },
  "coreCapabilities": {
    "tools": "supported",
    "resources": "supported",
    "prompts": "supported",
    "completions": "supported",
    "roots": "supported",
    "sampling": "supported",
    "elicitation": "supported"
  },
  "appsProfile": {
    "io.modelcontextprotocol/ui": "supported"
  }
}
<!-- roomd-support-matrix:json:end -->

## Core MCP Profile

### Protocol Spec Version

- `2025-11-25`

### Transport Support

| Transport | Status | Notes |
| --- | --- | --- |
| `streamable-http` | Supported | Preferred transport for HTTP MCP servers. |
| `legacy-sse` | Supported (Deprecated) | Supported for compatibility; see deprecation policy. |
| `stdio` | Supported | Controlled by command allowlist policy. |

### Capability Support

| Capability | Status | Notes |
| --- | --- | --- |
| `tools` (`tools/list`, `tools/call`) | Supported | Capability-gated with typed errors for unsupported routes. |
| `resources` (`list`, `read`, `subscribe`, `unsubscribe`, `templates/list`) | Supported | Capability-gated with typed errors for unsupported routes. |
| `prompts` (`prompts/list`, `prompts/get`) | Supported | Capability-gated with typed errors for unsupported routes. |
| `completions` (`completion/complete`) | Supported | Capability-gated with typed errors for unsupported routes. |
| `roots` | Supported | Host-side roots policy with list-changed notifications. |
| `sampling` | Supported | Host-side deterministic policy evaluation. |
| `elicitation` | Supported | Host-side deterministic policy evaluation with sensitive-mode controls. |

## MCP Apps Profile

| Extension/Profile | Status | Notes |
| --- | --- | --- |
| `io.modelcontextprotocol/ui` | Supported | UI discovery and resource handling are available via app-facing routes. |

## Tier 1 Conformance Scope

Current applicable required scenarios for `roomd`'s client boundary:

- `initialize`
- `tools_call`

Tier 1 for this boundary means 100% pass rate over the applicable required
scenario set above, enforced in CI.
