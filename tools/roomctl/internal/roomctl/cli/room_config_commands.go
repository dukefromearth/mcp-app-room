package cli

import (
	"context"
	"strings"

	"github.com/spf13/cobra"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/parse"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func newRoomConfigListCmd(opts *rootOptions) *cobra.Command {
	var namespace string

	cmd := &cobra.Command{
		Use:   "room-config-list [--namespace <namespace>]",
		Short: "List saved room configurations",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.RoomConfigList(ctx, namespace)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	return cmd
}

func newRoomConfigGetCmd(opts *rootOptions) *cobra.Command {
	var namespace string
	var configID string

	cmd := &cobra.Command{
		Use:   "room-config-get --config <config-id> [--namespace <namespace>]",
		Short: "Get one saved room configuration",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.RoomConfigGet(ctx, namespace, configID)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	cmd.Flags().StringVar(&configID, "config", "", "Room configuration ID")
	_ = cmd.MarkFlagRequired("config")
	return cmd
}

func newRoomConfigUpsertCmd(opts *rootOptions) *cobra.Command {
	var namespace string
	var configID string
	var owner string
	var visibility string
	var spec string

	cmd := &cobra.Command{
		Use:   "room-config-upsert --config <config-id> --spec '{...}' [--namespace <namespace>]",
		Short: "Create or update a saved room configuration",
		RunE: func(_ *cobra.Command, _ []string) error {
			specObject, err := parse.JSONObject(spec)
			if err != nil {
				return err
			}

			payload := map[string]any{
				"namespace":  namespace,
				"visibility": visibility,
				"spec":       specObject,
			}
			if strings.TrimSpace(owner) != "" {
				payload["owner"] = strings.TrimSpace(owner)
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.RoomConfigUpsert(ctx, configID, payload)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	cmd.Flags().StringVar(&configID, "config", "", "Room configuration ID")
	cmd.Flags().StringVar(&owner, "owner", "", "Owner identifier")
	cmd.Flags().StringVar(&visibility, "visibility", "private", "Visibility: private|shared")
	cmd.Flags().StringVar(&spec, "spec", "", "Room configuration spec JSON object")
	_ = cmd.MarkFlagRequired("config")
	_ = cmd.MarkFlagRequired("spec")
	return cmd
}

func newRoomConfigLoadCmd(opts *rootOptions) *cobra.Command {
	var namespace string
	var configID string
	var roomID string
	var mode string
	var dryRun bool
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "room-config-load --config <config-id> --room <room-id> [--namespace <namespace>] [--dry-run]",
		Short: "Load a saved room configuration into a room",
		RunE: func(_ *cobra.Command, _ []string) error {
			payload := map[string]any{
				"namespace":      namespace,
				"roomId":         roomID,
				"mode":           mode,
				"dryRun":         dryRun,
				"idempotencyKey": resolveIdempotencyKey(idempotencyKey),
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.RoomConfigLoad(ctx, configID, payload)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	cmd.Flags().StringVar(&configID, "config", "", "Room configuration ID")
	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&mode, "mode", "empty_only", "Load mode")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Plan without mutating room state")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("config")
	_ = cmd.MarkFlagRequired("room")
	return cmd
}

func newRoomConfigPlanCmd(opts *rootOptions) *cobra.Command {
	var namespace string
	var configID string
	var roomID string
	var mode string

	cmd := &cobra.Command{
		Use:   "room-config-plan --config <config-id> --room <room-id> [--namespace <namespace>]",
		Short: "Preview room configuration operations and diff before applying",
		RunE: func(_ *cobra.Command, _ []string) error {
			payload := map[string]any{
				"namespace": namespace,
				"roomId":    roomID,
				"mode":      mode,
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.RoomConfigPlan(ctx, configID, payload)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	cmd.Flags().StringVar(&configID, "config", "", "Room configuration ID")
	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&mode, "mode", "empty_only", "Planning mode")
	_ = cmd.MarkFlagRequired("config")
	_ = cmd.MarkFlagRequired("room")
	return cmd
}

func newRoomConfigSaveCmd(opts *rootOptions) *cobra.Command {
	var namespace string
	var roomID string
	var configID string
	var owner string
	var visibility string
	var title string
	var description string
	var tags []string

	cmd := &cobra.Command{
		Use:   "room-config-save --room <room-id> --config <config-id> [--namespace <namespace>]",
		Short: "Save current room state as a room configuration",
		RunE: func(_ *cobra.Command, _ []string) error {
			payload := map[string]any{
				"namespace":  namespace,
				"visibility": visibility,
			}
			if strings.TrimSpace(owner) != "" {
				payload["owner"] = strings.TrimSpace(owner)
			}
			if strings.TrimSpace(title) != "" {
				payload["title"] = strings.TrimSpace(title)
			}
			if strings.TrimSpace(description) != "" {
				payload["description"] = strings.TrimSpace(description)
			}
			parsedTags := parse.Order(tags)
			if len(parsedTags) > 0 {
				payload["tags"] = parsedTags
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.SaveRoomAsConfig(ctx, roomID, configID, payload)
			})
		},
	}

	cmd.Flags().StringVar(&namespace, "namespace", "default", "Room configuration namespace")
	cmd.Flags().StringVar(&roomID, "room", "", "Room ID to save")
	cmd.Flags().StringVar(&configID, "config", "", "Room configuration ID")
	cmd.Flags().StringVar(&owner, "owner", "", "Owner identifier")
	cmd.Flags().StringVar(&visibility, "visibility", "private", "Visibility: private|shared")
	cmd.Flags().StringVar(&title, "title", "", "Config title")
	cmd.Flags().StringVar(&description, "description", "", "Config description")
	cmd.Flags().StringSliceVar(&tags, "tags", nil, "Tags (comma-separated or repeated)")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("config")
	return cmd
}
