package cli

import (
	"fmt"
	"strings"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func enrichEnvelopeWithClaims(command string, env roomd.Envelope) roomd.Envelope {
	body, ok := env.Body.(map[string]any)
	if !ok {
		return env
	}

	claims, ok := deriveClaims(command, body)
	if !ok {
		return env
	}

	copied := make(map[string]any, len(body)+1)
	for key, value := range body {
		copied[key] = value
	}
	copied["claims"] = claims
	env.Body = copied
	return env
}

func deriveClaims(command string, body map[string]any) (map[string]any, bool) {
	stateMap, ok := body["state"].(map[string]any)
	if ok {
		assurance, ok := stateMap["assurance"].(map[string]any)
		if !ok {
			return nil, false
		}
		instances, ok := assurance["instances"].([]any)
		if !ok {
			return nil, false
		}

		proven := make([]string, 0)
		unknown := make([]string, 0)
		for _, raw := range instances {
			instance, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			instanceID := strings.TrimSpace(asString(instance["instanceId"]))
			label := instanceID
			if label == "" {
				label = "instance"
			}
			for _, claim := range asStringSlice(instance["proven"]) {
				proven = append(proven, fmt.Sprintf("[%s] %s", label, claim))
			}
			for _, claim := range asStringSlice(instance["unknown"]) {
				unknown = append(unknown, fmt.Sprintf("[%s] %s", label, claim))
			}
		}

		return map[string]any{
			"proven":  proven,
			"unknown": unknown,
		}, true
	}

	// GOTCHA: tool-call success only proves RPC completion; UI impact remains unknown.
	if command == "tool-call" && body["ok"] != false {
		if matches, ok := body["evidenceMatches"].(map[string]any); ok && len(matches) > 0 {
			proven := []string{
				"Tool RPC completed against upstream MCP endpoint.",
			}
			if _, hasInitialized := matches["app_initialized"]; hasInitialized {
				proven = append(proven, "Observed app_initialized lifecycle evidence for this call.")
			} else {
				proven = append(proven, "Observed lifecycle evidence for this call.")
			}
			return map[string]any{
				"proven":  proven,
				"unknown": []string{},
			}, true
		}
		return map[string]any{
			"proven": []string{
				"Tool RPC completed against upstream MCP endpoint.",
			},
			"unknown": []string{
				"User-visible UI impact is unknown without lifecycle evidence.",
			},
		}, true
	}

	return nil, false
}

func asStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		text := strings.TrimSpace(asString(item))
		if text == "" {
			continue
		}
		result = append(result, text)
	}
	return result
}
