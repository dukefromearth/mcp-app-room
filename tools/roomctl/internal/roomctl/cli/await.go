package cli

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func newAwaitPhaseCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var phaseName string
	var sinceRevision int
	var pollInterval time.Duration
	var maxWait time.Duration

	cmd := &cobra.Command{
		Use:   "await --room <room-id> --phase <phase-name> [--instance <instance-id>]",
		Short: "Wait until room lifecycle reaches the target phase",
		RunE: func(_ *cobra.Command, _ []string) error {
			if strings.TrimSpace(phaseName) == "" {
				return errors.New("--phase is required")
			}
			if pollInterval <= 0 {
				return errors.New("--poll-interval must be > 0")
			}
			if maxWait <= 0 {
				return errors.New("--max-wait must be > 0")
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				matched, match, revision, err := awaitPhase(
					ctx,
					client,
					roomID,
					instanceID,
					phaseName,
					sinceRevision,
					pollInterval,
					maxWait,
				)
				if err != nil {
					return roomd.Envelope{}, err
				}
				if matched {
					return roomd.Envelope{
						Status: 200,
						Body: map[string]any{
							"ok":        true,
							"phase":     phaseName,
							"instance":  strings.TrimSpace(instanceID),
							"revision":  revision,
							"match":     match,
							"maxWaitMs": maxWait.Milliseconds(),
						},
					}, nil
				}
				return roomd.Envelope{
					Status: 408,
					Body: map[string]any{
						"ok":    false,
						"code":  "PHASE_TIMEOUT",
						"error": fmt.Sprintf("Timed out waiting for lifecycle phase: %s", phaseName),
						"details": map[string]any{
							"room":          roomID,
							"instance":      strings.TrimSpace(instanceID),
							"phase":         phaseName,
							"sinceRevision": sinceRevision,
							"maxWaitMs":     maxWait.Milliseconds(),
						},
					},
				}, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Optional instance ID filter")
	cmd.Flags().StringVar(&phaseName, "phase", "", "Lifecycle phase name (e.g. app_initialized)")
	cmd.Flags().IntVar(&sinceRevision, "since-revision", 0, "Only match lifecycle state with revision > this value")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 300*time.Millisecond, "Polling interval while waiting")
	cmd.Flags().DurationVar(&maxWait, "max-wait", 15*time.Second, "Maximum time to wait for lifecycle phase")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("phase")

	return cmd
}

func awaitPhase(
	ctx context.Context,
	client *roomd.Client,
	roomID string,
	instanceID string,
	phaseName string,
	sinceRevision int,
	pollInterval time.Duration,
	maxWait time.Duration,
) (bool, map[string]any, int, error) {
	deadline := time.Now().Add(maxWait)
	lastRevision := 0
	for {
		stateEnv, err := client.State(ctx, roomID)
		if err != nil {
			return false, nil, lastRevision, err
		}

		matched, match, revision := findPhaseMatch(
			stateEnv.Body,
			phaseName,
			instanceID,
			sinceRevision,
		)
		lastRevision = revision
		if matched {
			return true, match, revision, nil
		}

		if time.Now().After(deadline) {
			return false, nil, lastRevision, nil
		}

		timer := time.NewTimer(pollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, nil, lastRevision, ctx.Err()
		case <-timer.C:
		}
	}
}

func findPhaseMatch(
	body any,
	phaseName string,
	instanceID string,
	sinceRevision int,
) (bool, map[string]any, int) {
	bodyMap, ok := body.(map[string]any)
	if !ok {
		return false, nil, 0
	}
	stateMap, ok := bodyMap["state"].(map[string]any)
	if !ok {
		return false, nil, 0
	}

	revision := asInt(stateMap["revision"])
	if revision <= sinceRevision {
		return false, nil, revision
	}

	lifecycle, ok := stateMap["lifecycle"].(map[string]any)
	if !ok {
		return false, nil, revision
	}
	instances, ok := lifecycle["instances"].([]any)
	if !ok {
		return false, nil, revision
	}

	wantInstance := strings.TrimSpace(instanceID)
	for _, raw := range instances {
		entry, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		currentPhase := strings.TrimSpace(asString(entry["phase"]))
		if !phaseSatisfiesTarget(currentPhase, strings.TrimSpace(phaseName)) {
			continue
		}
		if wantInstance != "" && strings.TrimSpace(asString(entry["instanceId"])) != wantInstance {
			continue
		}
		return true, entry, revision
	}

	return false, nil, revision
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func asInt(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case float32:
		return int(typed)
	case int:
		return typed
	case int64:
		return int(typed)
	default:
		return 0
	}
}
