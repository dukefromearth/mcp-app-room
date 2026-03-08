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
	var requiredPhaseFlag string
	var phasePollInterval time.Duration
	var phaseMaxWait time.Duration

	cmd := &cobra.Command{
		Use:   "tool-call --room <room-id> --instance <instance-id> --name <tool-name> [--arguments '{\"k\":1}']",
		Short: "Call a tool through a mounted instance endpoint (lifecycle-aware for UI-backed instances)",
		RunE: func(_ *cobra.Command, _ []string) error {
			obj, err := parse.JSONObject(arguments)
			if err != nil {
				return err
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				baselineRevision := 0
				requiredPhase := strings.TrimSpace(requiredPhaseFlag)
				awaitInferred := false

				stateEnv, err := client.State(ctx, roomID)
				if err != nil {
					return roomd.Envelope{}, err
				}
				stateBody, _ := stateEnv.Body.(map[string]any)
				stateMap, _ := stateBody["state"].(map[string]any)
				baselineRevision = asInt(stateMap["revision"])
				if requiredPhase == "" {
					requiredPhase = inferDefaultRequiredPhase(stateMap, instanceID)
					awaitInferred = requiredPhase != ""
				}

				env, err := client.InstanceToolCall(ctx, roomID, instanceID, name, obj)
				if err != nil {
					return roomd.Envelope{}, err
				}

				if requiredPhase == "" {
					return env, nil
				}

				matched, match, _, waitErr := awaitPhase(
					ctx,
					client,
					roomID,
					instanceID,
					requiredPhase,
					baselineRevision,
					phasePollInterval,
					phaseMaxWait,
				)
				if waitErr != nil {
					return roomd.Envelope{}, waitErr
				}

				if !matched {
					currentPhase := currentLifecyclePhase(stateMap, instanceID)
					latestStateEnv, latestErr := client.State(ctx, roomID)
					if latestErr == nil {
						latestBody, _ := latestStateEnv.Body.(map[string]any)
						latestStateMap, _ := latestBody["state"].(map[string]any)
						// GOTCHA: timeout details should reflect the latest observed phase, not
						// only the pre-call baseline snapshot used for await sinceRevision.
						currentPhase = currentLifecyclePhase(latestStateMap, instanceID)
					}
					return roomd.Envelope{
						Status: 412,
						Body: map[string]any{
							"ok":    false,
							"code":  "REQUIRED_PHASE_MISSING",
							"error": "Tool RPC completed, but required lifecycle phase was not observed",
							"details": map[string]any{
								"room":                   roomID,
								"instance":               instanceID,
								"expectedPhase":          requiredPhase,
								"currentPhase":           currentPhase,
								"baselineRevision":       baselineRevision,
								"timeoutMs":              phaseMaxWait.Milliseconds(),
								"awaitInferred":          awaitInferred,
								"recommendedNextCommand": "roomctl readiness --room " + roomID + " --instance " + instanceID,
							},
							"result": env.Body,
						},
					}, nil
				}

				if body, ok := env.Body.(map[string]any); ok {
					copied := make(map[string]any, len(body)+2)
					for key, value := range body {
						copied[key] = value
					}
					copied["phaseMatch"] = match
					copied["awaitInferred"] = awaitInferred
					env.Body = copied
					return env, nil
				}

				return roomd.Envelope{
					Status: env.Status,
					Body: map[string]any{
						"ok":            true,
						"result":        env.Body,
						"phaseMatch":    match,
						"awaitInferred": awaitInferred,
					},
				}, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&name, "name", "", "Tool name")
	cmd.Flags().StringVar(&arguments, "arguments", "{}", "Tool arguments as JSON object")
	cmd.Flags().StringVar(&requiredPhaseFlag, "phase", "", "Required lifecycle phase to observe after the call (default inferred for UI-backed instances)")
	cmd.Flags().DurationVar(&phasePollInterval, "phase-poll-interval", 300*time.Millisecond, "Polling interval while waiting for required lifecycle phase")
	cmd.Flags().DurationVar(&phaseMaxWait, "phase-max-wait", 10*time.Second, "Maximum wait time for required lifecycle phase")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func inferDefaultRequiredPhase(state map[string]any, instanceID string) string {
	if !isUIBackedInstance(state, instanceID) {
		return ""
	}

	if phaseSatisfiesTarget(currentLifecyclePhase(state, instanceID), "app_initialized") {
		return ""
	}

	return "app_initialized"
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

func currentLifecyclePhase(state map[string]any, instanceID string) string {
	lifecycle, ok := state["lifecycle"].(map[string]any)
	if !ok {
		return ""
	}
	instances, ok := lifecycle["instances"].([]any)
	if !ok {
		return ""
	}
	for _, raw := range instances {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(asString(entry["instanceId"])) != strings.TrimSpace(instanceID) {
			continue
		}
		return strings.TrimSpace(asString(entry["phase"]))
	}
	return ""
}
