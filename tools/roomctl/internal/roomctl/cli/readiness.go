package cli

import (
	"context"
	"strings"

	"github.com/spf13/cobra"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func newReadinessCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var targetPhase string

	cmd := &cobra.Command{
		Use:   "readiness --room <room-id> --instance <instance-id> [--phase <phase-name>]",
		Short: "Inspect current lifecycle phase, blockers, and remediation command",
		RunE: func(_ *cobra.Command, _ []string) error {
			if strings.TrimSpace(targetPhase) == "" {
				targetPhase = "app_initialized"
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				stateEnv, err := client.State(ctx, roomID)
				if err != nil {
					return roomd.Envelope{}, err
				}
				body, _ := stateEnv.Body.(map[string]any)
				state, _ := body["state"].(map[string]any)
				mounts, _ := state["mounts"].([]any)
				lifecycle, _ := state["lifecycle"].(map[string]any)
				instances, _ := lifecycle["instances"].([]any)

				mounted := false
				for _, raw := range mounts {
					mount, ok := raw.(map[string]any)
					if !ok {
						continue
					}
					if strings.TrimSpace(asString(mount["instanceId"])) == strings.TrimSpace(instanceID) {
						mounted = true
						break
					}
				}

				currentPhase := ""
				lastError := ""
				for _, raw := range instances {
					entry, ok := raw.(map[string]any)
					if !ok {
						continue
					}
					if strings.TrimSpace(asString(entry["instanceId"])) != strings.TrimSpace(instanceID) {
						continue
					}
					currentPhase = strings.TrimSpace(asString(entry["phase"]))
					lastError = strings.TrimSpace(asString(entry["lastError"]))
					break
				}

				blockers := make([]string, 0)
				if !mounted {
					blockers = append(blockers, "Instance is not mounted in this room.")
				}
				if mounted && currentPhase == "" {
					blockers = append(blockers, "No lifecycle phase has been reported yet.")
				}
				if mounted && !phaseSatisfiesTarget(currentPhase, targetPhase) {
					if currentPhase == "" {
						blockers = append(blockers, "Awaiting first lifecycle signal from host.")
					} else {
						blockers = append(blockers, "Current phase does not satisfy target phase.")
					}
				}
				if lastError != "" {
					blockers = append(blockers, "Lifecycle reported app_error.")
				}

				ready := mounted && phaseSatisfiesTarget(currentPhase, targetPhase) && len(lastError) == 0
				recommended := ""
				if !ready {
					recommended = "roomctl await --room " + roomID + " --instance " + instanceID + " --phase " + targetPhase
				}

				return roomd.Envelope{
					Status: 200,
					Body: map[string]any{
						"ok":                     true,
						"room":                   roomID,
						"instance":               instanceID,
						"targetPhase":            targetPhase,
						"currentPhase":           currentPhase,
						"lastError":              lastError,
						"ready":                  ready,
						"blockers":               blockers,
						"recommendedNextCommand": recommended,
					},
				}, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&targetPhase, "phase", "app_initialized", "Lifecycle phase required for readiness")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")

	return cmd
}

func phaseSatisfiesTarget(current string, target string) bool {
	rank := map[string]int{
		"":                   0,
		"bridge_connected":   1,
		"resource_delivered": 2,
		"app_initialized":    3,
		"app_error":          4,
	}
	currentRank, okCurrent := rank[current]
	targetRank, okTarget := rank[target]
	if !okCurrent || !okTarget {
		return false
	}
	if target == "app_error" {
		return current == "app_error"
	}
	if current == "app_error" {
		return false
	}
	return currentRank >= targetRank
}
