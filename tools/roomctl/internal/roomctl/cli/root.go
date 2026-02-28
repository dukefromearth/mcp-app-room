package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strconv"
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
		newStateGetCmd(opts),
		newInspectCmd(opts),
		newMountCmd(opts),
		newLifecycleCmd(opts, "hide"),
		newLifecycleCmd(opts, "show"),
		newLifecycleCmd(opts, "unmount"),
		newInstanceToolCallCmd(opts),
		newInstanceCapabilitiesCmd(opts),
		newInstanceToolsListCmd(opts),
		newInstanceResourcesListCmd(opts),
		newInstanceResourceReadCmd(opts),
		newInstanceResourceTemplatesListCmd(opts),
		newInstancePromptsListCmd(opts),
		newSelectCmd(opts),
		newReorderCmd(opts),
		newLayoutCmd(opts),
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

func newStateGetCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var valuePath string
	var optional bool

	cmd := &cobra.Command{
		Use:   "state-get --room <room-id> --path state.mounts.0.instanceId",
		Short: "Get a nested value from room state by dot path",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				env, err := client.State(ctx, roomID)
				if err != nil {
					return roomd.Envelope{}, err
				}

				value, found := lookupByPath(env.Body, valuePath)
				if !found && !optional {
					return roomd.Envelope{}, fmt.Errorf("path not found: %s", valuePath)
				}

				return roomd.Envelope{
					Status: env.Status,
					Body: map[string]any{
						"ok":    env.Status >= 200 && env.Status < 300,
						"path":  valuePath,
						"found": found,
						"value": value,
					},
				}, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&valuePath, "path", "", "Dot path into response body")
	cmd.Flags().BoolVar(&optional, "optional", false, "Return null when path does not exist")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("path")
	return cmd
}

func newInspectCmd(opts *rootOptions) *cobra.Command {
	var server string

	cmd := &cobra.Command{
		Use:   "inspect --server <url>",
		Short: "Inspect an MCP server before mount",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InspectServer(ctx, server)
			})
		},
	}

	cmd.Flags().StringVar(&server, "server", "", "Upstream MCP server URL")
	_ = cmd.MarkFlagRequired("server")
	return cmd
}

func newMountCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var server string
	var container string
	var uiResourceURI string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "mount --room <room-id> --instance <instance-id> --server <url> --container x,y,w,h [--ui-resource-uri <uri>]",
		Short: "Mount an MCP app/server instance into a room",
		RunE: func(_ *cobra.Command, _ []string) error {
			parsedContainer, err := parse.Container(container)
			if err != nil {
				return err
			}

			command := map[string]any{
				"type":       "mount",
				"instanceId": instanceID,
				"server":     server,
				"container":  parsedContainer,
			}

			if strings.TrimSpace(uiResourceURI) != "" {
				command["uiResourceUri"] = strings.TrimSpace(uiResourceURI)
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				env, err := client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
				if err != nil {
					return roomd.Envelope{}, err
				}
				if opts.output == "pretty" {
					printMountCommandHints(opts.stderr, env)
				}
				return env, nil
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&server, "server", "", "Upstream MCP server URL")
	cmd.Flags().StringVar(&container, "container", "", "Grid container as x,y,w,h")
	cmd.Flags().StringVar(&uiResourceURI, "ui-resource-uri", "", "Selected UI resource URI")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("server")
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

func newLayoutCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var adapter string
	var opsJSON string
	var idempotencyKey string

	cmd := &cobra.Command{
		Use:   "layout --room <room-id> --ops '[{\"op\":\"swap\",\"first\":\"inst-1\",\"second\":\"inst-2\"}]'",
		Short: "Apply layout operations to mounted containers",
		RunE: func(_ *cobra.Command, _ []string) error {
			ops, err := parse.JSONArrayObjects(opsJSON)
			if err != nil {
				return err
			}
			if len(ops) == 0 {
				return errors.New("--ops must include at least one operation")
			}

			command := map[string]any{
				"type":    "layout",
				"adapter": adapter,
				"ops":     ops,
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&adapter, "adapter", "grid12", "Layout adapter")
	cmd.Flags().StringVar(&opsJSON, "ops", "", "JSON array of layout operations")
	cmd.Flags().StringVar(&idempotencyKey, "idempotency-key", "", "Reuse key to make retries idempotent")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("ops")

	return cmd
}

func newInstanceToolCallCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var name string
	var arguments string

	cmd := &cobra.Command{
		Use:   "tool-call --room <room-id> --instance <instance-id> --name <tool-name> [--arguments '{\"k\":1}']",
		Short: "Call a tool through a mounted instance endpoint",
		RunE: func(_ *cobra.Command, _ []string) error {
			obj, err := parse.JSONObject(arguments)
			if err != nil {
				return err
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceToolCall(ctx, roomID, instanceID, name, obj)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&name, "name", "", "Tool name")
	cmd.Flags().StringVar(&arguments, "arguments", "{}", "Tool arguments as JSON object")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newInstanceCapabilitiesCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string

	cmd := &cobra.Command{
		Use:   "capabilities --room <room-id> --instance <instance-id>",
		Short: "Read server capabilities for a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceCapabilities(ctx, roomID, instanceID)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	return cmd
}

func newInstanceToolsListCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var cursor string

	cmd := &cobra.Command{
		Use:   "tools-list --room <room-id> --instance <instance-id> [--cursor <cursor>]",
		Short: "List tools from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceToolsList(ctx, roomID, instanceID, cursor)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&cursor, "cursor", "", "Pagination cursor")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	return cmd
}

func newInstanceResourcesListCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var cursor string

	cmd := &cobra.Command{
		Use:   "resources-list --room <room-id> --instance <instance-id> [--cursor <cursor>]",
		Short: "List resources from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceResourcesList(ctx, roomID, instanceID, cursor)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&cursor, "cursor", "", "Pagination cursor")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	return cmd
}

func newInstanceResourceReadCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var uri string

	cmd := &cobra.Command{
		Use:   "resources-read --room <room-id> --instance <instance-id> --uri <uri>",
		Short: "Read a resource from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceResourceRead(ctx, roomID, instanceID, uri)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&uri, "uri", "", "Resource URI")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("uri")
	return cmd
}

func newInstanceResourceTemplatesListCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var cursor string

	cmd := &cobra.Command{
		Use:   "resource-templates-list --room <room-id> --instance <instance-id> [--cursor <cursor>]",
		Short: "List resource templates from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceResourceTemplatesList(ctx, roomID, instanceID, cursor)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&cursor, "cursor", "", "Pagination cursor")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	return cmd
}

func newInstancePromptsListCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var cursor string

	cmd := &cobra.Command{
		Use:   "prompts-list --room <room-id> --instance <instance-id> [--cursor <cursor>]",
		Short: "List prompts from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstancePromptsList(ctx, roomID, instanceID, cursor)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&cursor, "cursor", "", "Pagination cursor")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	return cmd
}

func lookupByPath(root any, valuePath string) (any, bool) {
	current := root
	segments := strings.Split(valuePath, ".")
	for _, segment := range segments {
		if strings.TrimSpace(segment) == "" {
			return nil, false
		}

		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[segment]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}

	return current, true
}

func printMountCommandHints(out io.Writer, env roomd.Envelope) {
	if env.Status < 400 {
		return
	}

	body, ok := env.Body.(map[string]any)
	if !ok {
		return
	}

	rawCommands, ok := body["exampleCommands"]
	if !ok {
		return
	}

	commands, ok := rawCommands.([]any)
	if !ok || len(commands) == 0 {
		return
	}

	errorCode, _ := body["code"].(string)
	if strings.TrimSpace(errorCode) == "" {
		_, _ = fmt.Fprintln(out, "mount command failed; suggested next commands:")
	} else {
		_, _ = fmt.Fprintf(out, "mount command failed (%s); suggested next commands:\n", errorCode)
	}

	for _, entry := range commands {
		commandText, ok := entry.(string)
		if !ok || strings.TrimSpace(commandText) == "" {
			continue
		}
		_, _ = fmt.Fprintf(out, "  %s\n", commandText)
	}
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
