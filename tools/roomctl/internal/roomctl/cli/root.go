package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/spf13/cobra"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/parse"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

const (
	defaultBaseURL = "http://localhost:8090"
	defaultTimeout = 10 * time.Second
)

type rootOptions struct {
	baseURL string
	timeout time.Duration
	output  string
	stderr  io.Writer
	stdout  io.Writer
}

func NewRootCmd() *cobra.Command {
	return newRootCmdWithOptions(&rootOptions{
		baseURL: envOrDefault("ROOMD_BASE_URL", defaultBaseURL),
		timeout: defaultTimeout,
		output:  "pretty",
		stderr:  os.Stderr,
		stdout:  os.Stdout,
	})
}

func newRootCmdWithOptions(opts *rootOptions) *cobra.Command {
	if opts.stderr == nil {
		opts.stderr = os.Stderr
	}
	if opts.stdout == nil {
		opts.stdout = os.Stdout
	}

	cmd := &cobra.Command{
		Use:           "roomctl",
		Short:         "roomd command-line client",
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRunE: func(_ *cobra.Command, _ []string) error {
			switch opts.output {
			case "pretty", "json":
				return nil
			default:
				return fmt.Errorf("unsupported --output value %q, expected pretty or json", opts.output)
			}
		},
		RunE: func(c *cobra.Command, _ []string) error {
			return c.Help()
		},
	}

	cmd.SetErr(opts.stderr)
	cmd.SetOut(opts.stdout)

	cmd.PersistentFlags().StringVar(&opts.baseURL, "base-url", opts.baseURL, "roomd base URL (env: ROOMD_BASE_URL)")
	cmd.PersistentFlags().DurationVar(&opts.timeout, "timeout", opts.timeout, "HTTP timeout (e.g. 5s, 30s)")
	cmd.PersistentFlags().StringVarP(&opts.output, "output", "o", opts.output, "Output format: pretty|json")

	cmd.AddCommand(
		newHealthCmd(opts),
		newCreateCmd(opts),
		newStateCmd(opts),
		newMountCmd(opts),
		newLifecycleCmd(opts, "hide"),
		newLifecycleCmd(opts, "show"),
		newLifecycleCmd(opts, "unmount"),
		newCallCmd(opts),
		newSelectCmd(opts),
		newReorderCmd(opts),
	)

	return cmd
}

func newHealthCmd(opts *rootOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check roomd health endpoint",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Health(ctx)
			})
		},
	}
}

func newCreateCmd(opts *rootOptions) *cobra.Command {
	var roomID string

	cmd := &cobra.Command{
		Use:   "create --room <room-id>",
		Short: "Create a room",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.CreateRoom(ctx, roomID)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	_ = cmd.MarkFlagRequired("room")
	return cmd
}

func newStateCmd(opts *rootOptions) *cobra.Command {
	var roomID string

	cmd := &cobra.Command{
		Use:   "state --room <room-id>",
		Short: "Get current room state",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.State(ctx, roomID)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	_ = cmd.MarkFlagRequired("room")
	return cmd
}

func newMountCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var server string
	var toolName string
	var container string
	var input string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "mount --room <room-id> --instance <instance-id> --server <url> --tool <name> --container x,y,w,h",
		Short: "Mount an MCP tool instance into a room",
		RunE: func(_ *cobra.Command, _ []string) error {
			parsedContainer, err := parse.Container(container)
			if err != nil {
				return err
			}

			command := map[string]any{
				"type":       "mount",
				"instanceId": instanceID,
				"server":     server,
				"toolName":   toolName,
				"container":  parsedContainer,
			}

			if strings.TrimSpace(input) != "" {
				obj, err := parse.JSONObject(input)
				if err != nil {
					return err
				}
				command["initialInput"] = obj
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&server, "server", "", "Upstream MCP server URL")
	cmd.Flags().StringVar(&toolName, "tool", "", "MCP tool name")
	cmd.Flags().StringVar(&container, "container", "", "Grid container as x,y,w,h")
	cmd.Flags().StringVar(&input, "input", "", "Initial JSON object input")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("server")
	_ = cmd.MarkFlagRequired("tool")
	_ = cmd.MarkFlagRequired("container")

	return cmd
}

func newLifecycleCmd(opts *rootOptions, commandType string) *cobra.Command {
	var roomID string
	var instanceID string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   commandType + " --room <room-id> --instance <instance-id>",
		Short: commandTitle(commandType) + " a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			command := map[string]any{
				"type":       commandType,
				"instanceId": instanceID,
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")

	return cmd
}

func newCallCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var input string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "call --room <room-id> --instance <instance-id> [--input '{" + `"k":1` + "}']",
		Short: "Invoke a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			obj, err := parse.JSONObject(input)
			if err != nil {
				return err
			}

			command := map[string]any{
				"type":       "call",
				"instanceId": instanceID,
				"input":      obj,
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&input, "input", "{}", "Input JSON object")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")

	return cmd
}

func newSelectCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var clearSelection bool
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "select --room <room-id> [--instance <instance-id> | --clear]",
		Short: "Select or clear the selected instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			if clearSelection && strings.TrimSpace(instanceID) != "" {
				return errors.New("use either --instance or --clear, not both")
			}
			if !clearSelection && strings.TrimSpace(instanceID) == "" {
				return errors.New("--instance is required unless --clear is set")
			}

			var selected any
			if clearSelection {
				selected = nil
			} else {
				selected = instanceID
			}

			command := map[string]any{
				"type":       "select",
				"instanceId": selected,
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID to select")
	cmd.Flags().BoolVar(&clearSelection, "clear", false, "Clear current selection")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")

	return cmd
}

func newReorderCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var order []string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "reorder --room <room-id> --order inst-1,inst-2[,inst-3]",
		Short: "Reorder mounted instances",
		RunE: func(_ *cobra.Command, _ []string) error {
			parsedOrder := parse.Order(order)
			if len(parsedOrder) == 0 {
				return errors.New("--order must include at least one instance ID")
			}

			command := map[string]any{
				"type":  "reorder",
				"order": parsedOrder,
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringSliceVar(&order, "order", nil, "Ordered instance IDs (comma-separated or repeated)")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("order")

	return cmd
}

func runWithClient(opts *rootOptions, run func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error)) error {
	if opts.timeout <= 0 {
		return errors.New("--timeout must be > 0")
	}

	client, err := roomd.NewClient(opts.baseURL, opts.timeout)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	envelope, err := run(ctx, client)
	if err != nil {
		return err
	}

	return printEnvelope(opts.stdout, opts.output, envelope)
}

func printEnvelope(out io.Writer, format string, envelope roomd.Envelope) error {
	var (
		data []byte
		err  error
	)

	switch format {
	case "json":
		data, err = json.Marshal(envelope)
	case "pretty":
		data, err = json.MarshalIndent(envelope, "", "  ")
	default:
		return fmt.Errorf("unsupported output format: %s", format)
	}
	if err != nil {
		return fmt.Errorf("marshal output: %w", err)
	}

	_, err = fmt.Fprintln(out, string(data))
	return err
}

func resolveIdempotencyKey(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return uuid.NewString()
}

func envOrDefault(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func commandTitle(value string) string {
	if value == "" {
		return value
	}
	return strings.ToUpper(value[:1]) + value[1:]
}
