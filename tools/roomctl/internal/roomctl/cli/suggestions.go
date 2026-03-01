package cli

import (
	"strings"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

var (
	roomStateThenMountSuggestions = []suggestion{
		{Cmd: "roomctl state --room {{room}}", Description: "Use the existing room and inspect current state."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Proceed by mounting an instance into the existing room."},
	}
	instanceExistsSuggestions = []suggestion{
		{Cmd: "roomctl state --room {{room}}", Description: "Confirm the existing instance and current layout before remounting."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Retry with a new instance ID if another mount is required."},
	}
	instanceNotFoundSuggestions = []suggestion{
		{Cmd: "roomctl state --room {{room}}", Description: "List mounted instances and verify the instance ID."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Mount the instance if it does not exist yet."},
	}
	roomCreateThenMountSuggestions = []suggestion{
		{Cmd: "roomctl create --room {{room}}", Description: "Create the room before running room-scoped commands."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Retry mount after the room exists."},
	}
	roomStateThenStateGetSuggestions = []suggestion{
		{Cmd: "roomctl state --room {{room}}", Description: "Check whether the original command already applied."},
		{Cmd: "roomctl state-get --room {{room}} --path state.revision", Description: "Compare room revision before deciding whether to retry the write."},
	}
	capabilitiesThenToolsSuggestions = []suggestion{
		{Cmd: "roomctl capabilities --room {{room}} --instance {{instance}}", Description: "Check negotiated capabilities before invoking gated endpoints."},
		{Cmd: "roomctl list-tools --room {{room}} --instance {{instance}}", Description: "Fallback to tools exposed by this instance when a primitive is unavailable."},
	}
	stateThenInspectSuggestions = []suggestion{
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect current state to verify valid instance IDs and layout fields."},
		{Cmd: "roomctl inspect --server {{server}}", Description: "Re-check server metadata before retrying with corrected arguments."},
	}
	inspectThenMountUiSuggestions = []suggestion{
		{Cmd: "roomctl inspect --server {{server}}", Description: "Discover UI candidates exposed by the server."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}} --ui-resource-uri {{ui-resource-uri}}", Description: "Retry mount with a valid UI resource URI from inspect output."},
	}
	inspectThenMountSuggestions = []suggestion{
		{Cmd: "roomctl inspect --server {{server}}", Description: "Inspect auth requirements and transport metadata for this server."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Retry mount after supplying required credentials or auth policy."},
	}
	startThenInspectSuggestions = []suggestion{
		{Cmd: "npm run roomd:start", Description: "Restart roomd using global config security.profile=local-dev for permissive local mounts."},
		{Cmd: "roomctl inspect --server {{server}}", Description: "Verify descriptor parsing before attempting another mount."},
	}
	inspectThenHealthSuggestions = []suggestion{
		{Cmd: "roomctl inspect --server {{server}}", Description: "Confirm the upstream MCP endpoint is reachable and protocol-compliant."},
		{Cmd: "roomctl health", Description: "Verify roomd itself is healthy before retrying."},
	}
	startThenHealthSuggestions = []suggestion{
		{Cmd: "npm run roomd:start", Description: "Start roomd when it is not listening at the configured base URL."},
		{Cmd: "roomctl health", Description: "Retry health after roomd is running."},
	}
	timeoutRetrySuggestions = []suggestion{
		{Cmd: "roomctl health --timeout {{timeout}}", Description: "Retry with a larger timeout for slow environments."},
		{Cmd: "roomctl inspect --server {{server}} --timeout {{timeout}}", Description: "Re-run inspect with an explicit timeout value."},
	}
	healthThenInspectSuggestions = []suggestion{
		{Cmd: "roomctl health", Description: "Confirm roomd is reachable and responding."},
		{Cmd: "roomctl inspect --server {{server}}", Description: "Retry with a known-good MCP endpoint after verifying health."},
	}
	roomConfigListThenUpsertSuggestions = []suggestion{
		{Cmd: "roomctl room-config-list --namespace {{namespace}}", Description: "List existing room configurations in this namespace."},
		{Cmd: "roomctl room-config-upsert --config {{config}} --spec {{spec-json}} --namespace {{namespace}}", Description: "Create a new room configuration before loading it."},
	}
)

var errorSuggestions = map[string][]suggestion{
	"ROOM_EXISTS":    roomStateThenMountSuggestions,
	"ROOM_NOT_FOUND": roomCreateThenMountSuggestions,
	"ROOM_NOT_EMPTY": {
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect existing mounts before applying another configuration."},
		{Cmd: "roomctl room-config-plan --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Preview the load plan before clearing or using another room."},
	},
	"INSTANCE_EXISTS":          instanceExistsSuggestions,
	"INSTANCE_NOT_FOUND":       instanceNotFoundSuggestions,
	"CONFIG_NOT_FOUND":         roomConfigListThenUpsertSuggestions,
	"IDEMPOTENCY_CONFLICT":     roomStateThenStateGetSuggestions,
	"UNSUPPORTED_CAPABILITY":   capabilitiesThenToolsSuggestions,
	"INVALID_PAYLOAD":          stateThenInspectSuggestions,
	"INVALID_COMMAND":          stateThenInspectSuggestions,
	"NO_UI_RESOURCE":           inspectThenMountUiSuggestions,
	"UI_RESOURCE_INVALID":      inspectThenMountUiSuggestions,
	"AUTH_REQUIRED":            inspectThenMountSuggestions,
	"AUTH_FAILED":              inspectThenMountSuggestions,
	"AUTH_DISCOVERY_FAILED":    inspectThenMountSuggestions,
	"SERVER_NOT_ALLOWLISTED":   startThenInspectSuggestions,
	"UPSTREAM_TRANSPORT_ERROR": inspectThenHealthSuggestions,
	"ROOMD_UNREACHABLE":        startThenHealthSuggestions,
	"ROOMD_TIMEOUT":            timeoutRetrySuggestions,
	"EVIDENCE_TIMEOUT": {
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect current evidence and assurance levels before retrying wait conditions."},
		{Cmd: "roomctl await --room {{room}} --event {{event}} --max-wait {{timeout}}", Description: "Retry with a larger wait budget when lifecycle events are delayed."},
	},
	"REQUIRED_EVIDENCE_MISSING": {
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect lifecycle evidence and assurance to diagnose missing post-call signals."},
		{Cmd: "roomctl await --room {{room}} --instance {{instance}} --event {{event}}", Description: "Wait for required lifecycle evidence before presenting user-visible outcomes as proven."},
	},
	"INVALID_BASE_URL": {
		{Cmd: "roomctl health --base-url {{base-url}}", Description: "Use a valid roomd URL including scheme and host."},
	},
	"ROOMD_CLIENT_ERROR": healthThenInspectSuggestions,
	"INTERNAL_ERROR":     healthThenInspectSuggestions,
}

var defaultCommandSuggestions = map[string][]suggestion{
	"health": {
		{Cmd: "roomctl inspect --server {{server}}", Description: "Inspect an MCP endpoint to discover tools and UI candidates."},
		{Cmd: "roomctl create --room {{room}}", Description: "Create a room before mounting instances."},
	},
	"inspect": {
		{Cmd: "roomctl create --room {{room}}", Description: "Create a room to hold mounted instances."},
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Mount the inspected MCP server into a room grid slot."},
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after mounting."},
	},
	"create": {
		{Cmd: "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}", Description: "Mount an MCP server into the newly created room."},
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect current mounts, order, and selected instance."},
	},
	"room-config-list": {
		{Cmd: "roomctl room-config-get --config {{config}} --namespace {{namespace}}", Description: "Inspect a specific room configuration by ID."},
		{Cmd: "roomctl room-config-load --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Load a configuration into a room."},
	},
	"room-config-get": {
		{Cmd: "roomctl room-config-load --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Load this configuration into a room."},
		{Cmd: "roomctl room-config-upsert --config {{config}} --spec {{spec-json}} --namespace {{namespace}}", Description: "Update configuration values and save a new revision."},
	},
	"room-config-upsert": {
		{Cmd: "roomctl room-config-get --config {{config}} --namespace {{namespace}}", Description: "Verify the saved configuration contract."},
		{Cmd: "roomctl room-config-plan --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Preview load behavior before applying."},
	},
	"room-config-plan": {
		{Cmd: "roomctl room-config-load --config {{config}} --room {{room}} --namespace {{namespace}} --dry-run", Description: "Validate load endpoint behavior with no state mutation."},
		{Cmd: "roomctl room-config-load --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Apply the planned operations to room state."},
	},
	"room-config-load": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after loading configuration."},
		{Cmd: "roomctl room-config-plan --config {{config}} --room {{room}} --namespace {{namespace}}", Description: "Re-check load plan without mutating state."},
	},
	"room-config-save": {
		{Cmd: "roomctl room-config-get --config {{config}} --namespace {{namespace}}", Description: "Inspect the saved configuration payload."},
		{Cmd: "roomctl room-config-load --config {{config}} --room {{room}} --namespace {{namespace}} --dry-run", Description: "Validate the configuration can be reloaded safely."},
	},
	"mount": {
		{Cmd: "roomctl list-tools --room {{room}} --instance {{instance}}", Description: "List available tools for the mounted instance."},
		{Cmd: "roomctl tool-call --room {{room}} --instance {{instance}} --name {{tool}} --arguments {{arguments-json}}", Description: "Execute a tool call through the mounted instance."},
		{Cmd: "roomctl state --room {{room}}", Description: "Verify mount order, selection, and layout."},
	},
	"state": {
		{Cmd: "roomctl state-get --room {{room}} --path state.selectedInstanceId", Description: "Read the selected instance from room state."},
		{Cmd: "roomctl state-get --room {{room}} --path state.mounts.0.container", Description: "Inspect the first mounted instance container coordinates."},
	},
	"state-get": {
		{Cmd: "roomctl state-get --room {{room}} --path state.selectedInstanceId", Description: "Use full response paths rooted at `state`."},
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect full state to discover available paths."},
	},
	"await": {
		{Cmd: "roomctl state --room {{room}}", Description: "Inspect latest evidence records and assurance summaries for this room."},
		{Cmd: "roomctl await --room {{room}} --event {{event}} --instance {{instance}}", Description: "Wait for specific instance lifecycle evidence before declaring UI outcomes."},
	},
	"tools-list": {
		{Cmd: "roomctl tool-call --room {{room}} --instance {{instance}} --name {{tool}} --arguments {{arguments-json}}", Description: "Call one of the listed tools."},
		{Cmd: "roomctl capabilities --room {{room}} --instance {{instance}}", Description: "View negotiated capabilities for this instance."},
	},
	"tool-call": {
		{Cmd: "roomctl list-tools --room {{room}} --instance {{instance}}", Description: "Re-check tool names and schemas before another call."},
		{Cmd: "roomctl state --room {{room}}", Description: "Review invocation status history in room state."},
	},
	"capabilities": {
		{Cmd: "roomctl list-tools --room {{room}} --instance {{instance}}", Description: "List tools available on this mounted instance."},
		{Cmd: "roomctl resources-list --room {{room}} --instance {{instance}}", Description: "List resources if resource capability is available."},
	},
	"resources-list": {
		{Cmd: "roomctl resources-read --room {{room}} --instance {{instance}} --uri {{uri}}", Description: "Read a resource returned by resources/list."},
		{Cmd: "roomctl resource-templates-list --room {{room}} --instance {{instance}}", Description: "List URI templates when concrete resources require parameters."},
	},
	"resources-read": {
		{Cmd: "roomctl resources-list --room {{room}} --instance {{instance}}", Description: "List resources again to select another URI."},
	},
	"resource-templates-list": {
		{Cmd: "roomctl resources-read --room {{room}} --instance {{instance}} --uri {{uri}}", Description: "Read a concrete URI resolved from one of the listed templates."},
	},
	"prompts-list": {
		{Cmd: "roomctl prompts-get --room {{room}} --instance {{instance}} --name {{prompt}} --arguments {{arguments-json}}", Description: "Resolve one of the listed prompts."},
	},
	"prompts-get": {
		{Cmd: "roomctl complete --room {{room}} --instance {{instance}} --params {{params-json}}", Description: "Request completion options for prompt arguments."},
	},
	"complete": {
		{Cmd: "roomctl prompts-get --room {{room}} --instance {{instance}} --name {{prompt}} --arguments {{arguments-json}}", Description: "Fetch prompt output with explicit argument values."},
	},
	"resources-subscribe": {
		{Cmd: "roomctl resources-list --room {{room}} --instance {{instance}}", Description: "List resources to verify valid subscription URIs."},
	},
	"resources-unsubscribe": {
		{Cmd: "roomctl resources-list --room {{room}} --instance {{instance}}", Description: "List resources to verify valid subscription URIs."},
	},
	"hide": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
	"show": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
	"select": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
	"reorder": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
	"layout": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
	"unmount": {
		{Cmd: "roomctl state --room {{room}}", Description: "Verify room state after lifecycle or layout changes."},
	},
}

var errorCommandSuggestions = map[string][]suggestion{
	"inspect": {
		{Cmd: "roomctl health", Description: "Verify roomd is reachable before retrying inspect."},
		{Cmd: "roomctl inspect --server {{server}}", Description: "Retry with a valid MCP endpoint or stdio descriptor."},
	},
	"mount": {
		{Cmd: "roomctl inspect --server {{server}}", Description: "Check server metadata and mountability before retrying."},
		{Cmd: "roomctl state --room {{room}}", Description: "Confirm current room mounts and layout."},
	},
}

func suggestionsFor(command string, env roomd.Envelope) []suggestion {
	if byCode, ok := errorSuggestions[envelopeErrorCode(env)]; ok {
		return byCode
	}
	if env.Status >= 400 {
		if byCommand, ok := errorCommandSuggestions[command]; ok {
			return byCommand
		}
	}
	return defaultCommandSuggestions[command]
}

func envelopeErrorCode(env roomd.Envelope) string {
	body, ok := env.Body.(map[string]any)
	if !ok {
		return ""
	}
	code, _ := body["code"].(string)
	return strings.TrimSpace(code)
}
