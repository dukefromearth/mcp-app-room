package cli

import (
	"context"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/parse"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func newInstanceToolCallCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var name string
	var arguments string
	var noAwait bool
	var requireEvidence []string
	var evidencePollInterval time.Duration
	var evidenceMaxWait time.Duration

	cmd := &cobra.Command{
		Use:   "tool-call --room <room-id> --instance <instance-id> --name <tool-name> [--arguments '{\"k\":1}']",
		Short: "Call a tool through a mounted instance endpoint (awaits UI lifecycle by default)",
		RunE: func(_ *cobra.Command, _ []string) error {
			obj, err := parse.JSONObject(arguments)
			if err != nil {
				return err
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				baselineRevision := 0
				required := compactNonEmpty(requireEvidence)
				awaitEnabled := !noAwait
				awaitInferred := false

				if awaitEnabled || len(required) > 0 {
					stateEnv, err := client.State(ctx, roomID)
					if err != nil {
						return roomd.Envelope{}, err
					}
					if body, ok := stateEnv.Body.(map[string]any); ok {
						if state, ok := body["state"].(map[string]any); ok {
							baselineRevision = asInt(state["revision"])
						}
						if len(required) == 0 && awaitEnabled {
							required = inferDefaultAwaitEvidence(body, instanceID)
							awaitInferred = len(required) > 0
						}
					}
				}

				env, err := client.InstanceToolCall(ctx, roomID, instanceID, name, obj)
				if err != nil {
					return roomd.Envelope{}, err
				}
				if len(required) == 0 {
					return env, nil
				}

				matches := make(map[string]any, len(required))
				missing := make([]string, 0)
				for _, event := range required {
					matched, match, _, waitErr := awaitEvidence(
						ctx,
						client,
						roomID,
						instanceID,
						event,
						baselineRevision,
						evidencePollInterval,
						evidenceMaxWait,
					)
					if waitErr != nil {
						return roomd.Envelope{}, waitErr
					}
					if matched {
						matches[event] = match
						continue
					}
					missing = append(missing, event)
				}

				if len(missing) > 0 {
					return roomd.Envelope{
						Status: 412,
						Body: map[string]any{
							"ok":    false,
							"code":  "REQUIRED_EVIDENCE_MISSING",
							"error": "Tool RPC completed, but required lifecycle evidence was not observed",
							"details": map[string]any{
								"room":             roomID,
								"instance":         instanceID,
								"requiredEvidence": required,
								"missingEvidence":  missing,
								"baselineRevision": baselineRevision,
								"maxWaitMs":        evidenceMaxWait.Milliseconds(),
								"awaitInferred":    awaitInferred,
							},
							"result": env.Body,
						},
					}, nil
				}

				if body, ok := env.Body.(map[string]any); ok {
					copied := make(map[string]any, len(body)+1)
					for key, value := range body {
						copied[key] = value
					}
					copied["evidenceMatches"] = matches
					copied["awaitInferred"] = awaitInferred
					env.Body = copied
					return env, nil
				}

				return roomd.Envelope{
					Status: env.Status,
					Body: map[string]any{
						"ok":              true,
						"result":          env.Body,
						"evidenceMatches": matches,
						"awaitInferred":   awaitInferred,
					},
				}, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&name, "name", "", "Tool name")
	cmd.Flags().StringVar(&arguments, "arguments", "{}", "Tool arguments as JSON object")
	cmd.Flags().BoolVar(&noAwait, "no-await", false, "Disable default post-call evidence waiting")
	cmd.Flags().StringSliceVar(&requireEvidence, "require-evidence", nil, "Evidence event names that must be observed after call (repeat or comma-separated)")
	cmd.Flags().DurationVar(&evidencePollInterval, "evidence-poll-interval", 300*time.Millisecond, "Polling interval while waiting for required evidence")
	cmd.Flags().DurationVar(&evidenceMaxWait, "evidence-max-wait", 10*time.Second, "Maximum wait time per required evidence event")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("name")
	_ = cmd.Flags().MarkHidden("no-await")
	return cmd
}

func inferDefaultAwaitEvidence(body map[string]any, instanceID string) []string {
	state, ok := body["state"].(map[string]any)
	if !ok {
		return nil
	}
	if !isUIBackedInstance(state, instanceID) {
		return nil
	}

	// GOTCHA: we only await by default when UI bootstrap is not yet proven for this instance.
	if currentInstanceAssuranceLevel(state, instanceID) == "ui_app_initialized" {
		return nil
	}

	return []string{DefaultAwaitEvidenceEvent}
}

func isUIBackedInstance(state map[string]any, instanceID string) bool {
	mounts, ok := state["mounts"].([]any)
	if !ok {
		return false
	}
	for _, raw := range mounts {
		mount, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(asString(mount["instanceId"])) != strings.TrimSpace(instanceID) {
			continue
		}
		return strings.TrimSpace(asString(mount["uiResourceUri"])) != ""
	}
	return false
}

func currentInstanceAssuranceLevel(state map[string]any, instanceID string) string {
	assurance, ok := state["assurance"].(map[string]any)
	if !ok {
		return ""
	}
	instances, ok := assurance["instances"].([]any)
	if !ok {
		return ""
	}
	for _, raw := range instances {
		instance, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(asString(instance["instanceId"])) != strings.TrimSpace(instanceID) {
			continue
		}
		return strings.TrimSpace(asString(instance["level"]))
	}
	return ""
}

func compactNonEmpty(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			trimmed := strings.TrimSpace(part)
			if trimmed == "" {
				continue
			}
			result = append(result, trimmed)
		}
	}
	return result
}
