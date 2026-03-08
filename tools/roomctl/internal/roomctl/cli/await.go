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

func newAwaitEvidenceCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var eventName string
	var sinceRevision int
	var pollInterval time.Duration
	var maxWait time.Duration

	cmd := &cobra.Command{
		Use:   "await --room <room-id> --event <event-name> [--instance <instance-id>]",
		Short: "Wait until room state evidence contains the target event",
		RunE: func(_ *cobra.Command, _ []string) error {
			if strings.TrimSpace(eventName) == "" {
				return errors.New("--event is required")
			}
			if pollInterval <= 0 {
				return errors.New("--poll-interval must be > 0")
			}
			if maxWait <= 0 {
				return errors.New("--max-wait must be > 0")
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				matched, match, revision, err := awaitEvidence(
					ctx,
					client,
					roomID,
					instanceID,
					eventName,
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
							"event":     eventName,
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
						"code":  "EVIDENCE_TIMEOUT",
						"error": fmt.Sprintf("Timed out waiting for evidence event: %s", eventName),
						"details": map[string]any{
							"room":          roomID,
							"instance":      strings.TrimSpace(instanceID),
							"event":         eventName,
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
	cmd.Flags().StringVar(&eventName, "event", "", fmt.Sprintf("Evidence event name (e.g. %s)", DefaultAwaitEvidenceEvent))
	cmd.Flags().IntVar(&sinceRevision, "since-revision", 0, "Only match evidence with revision > this value")
	cmd.Flags().DurationVar(&pollInterval, "poll-interval", 300*time.Millisecond, "Polling interval while waiting")
	cmd.Flags().DurationVar(&maxWait, "max-wait", 15*time.Second, "Maximum time to wait for evidence")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("event")

	return cmd
}

func awaitEvidence(
	ctx context.Context,
	client *roomd.Client,
	roomID string,
	instanceID string,
	eventName string,
	sinceRevision int,
	pollInterval time.Duration,
	maxWait time.Duration,
) (bool, map[string]any, int, error) {
	deadline := time.Now().Add(maxWait)
	lastStateRevision := 0
	for {
		stateEnv, err := client.State(ctx, roomID)
		if err != nil {
			return false, nil, lastStateRevision, err
		}

		matched, match, matchedRevision, stateRevision := findEvidenceMatch(
			stateEnv.Body,
			eventName,
			instanceID,
			sinceRevision,
		)
		lastStateRevision = stateRevision
		if matched {
			return true, match, matchedRevision, nil
		}

		if time.Now().After(deadline) {
			return false, nil, lastStateRevision, nil
		}

		timer := time.NewTimer(pollInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return false, nil, lastStateRevision, ctx.Err()
		case <-timer.C:
		}
	}
}

func findEvidenceMatch(
	body any,
	eventName string,
	instanceID string,
	sinceRevision int,
) (bool, map[string]any, int, int) {
	bodyMap, ok := body.(map[string]any)
	if !ok {
		return false, nil, 0, 0
	}
	stateMap, ok := bodyMap["state"].(map[string]any)
	if !ok {
		return false, nil, 0, 0
	}

	stateRevision := asInt(stateMap["revision"])
	evidenceList, ok := stateMap["evidence"].([]any)
	if !ok {
		return false, nil, 0, stateRevision
	}

	wantInstance := strings.TrimSpace(instanceID)
	for _, raw := range evidenceList {
		evidenceMap, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if strings.TrimSpace(asString(evidenceMap["event"])) != strings.TrimSpace(eventName) {
			continue
		}
		if asInt(evidenceMap["revision"]) <= sinceRevision {
			continue
		}
		if wantInstance != "" && strings.TrimSpace(asString(evidenceMap["instanceId"])) != wantInstance {
			continue
		}
		// GOTCHA: return the matched evidence revision, not the latest room
		// state revision. Chained waits use this as a cursor.
		return true, evidenceMap, asInt(evidenceMap["revision"]), stateRevision
	}

	return false, nil, 0, stateRevision
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
