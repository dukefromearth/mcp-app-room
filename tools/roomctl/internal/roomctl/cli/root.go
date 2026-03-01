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

	roomctlconfig "github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/config"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/parse"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

const (
	defaultTimeout = 10 * time.Second
)

type rootOptions struct {
	configPath string
	baseURL    string
	timeout    time.Duration
	output     string
	stderr     io.Writer
	stdout     io.Writer
	command    string
}

type suggestion struct {
	Cmd         string `json:"cmd"`
	Description string `json:"description"`
}

func NewRootCmd() *cobra.Command {
	return newRootCmdWithOptions(&rootOptions{
		configPath: "",
		baseURL:    "",
		timeout:    defaultTimeout,
		output:     "pretty",
		stderr:     os.Stderr,
		stdout:     os.Stdout,
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
		PersistentPreRunE: func(c *cobra.Command, _ []string) error {
			opts.command = c.Name()
			if strings.TrimSpace(opts.baseURL) == "" {
				cfg, err := roomctlconfig.Load(opts.configPath)
				if err != nil {
					return fmt.Errorf("load config: %w", err)
				}
				opts.baseURL = cfg.Roomd.BaseURL
			}
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

	cmd.PersistentFlags().StringVar(&opts.configPath, "config", opts.configPath, "Path to global YAML config (default: auto-discover config/global.yaml)")
	cmd.PersistentFlags().StringVar(&opts.baseURL, "base-url", opts.baseURL, "roomd base URL (overrides config)")
	cmd.PersistentFlags().DurationVar(&opts.timeout, "timeout", opts.timeout, "HTTP timeout (e.g. 5s, 30s)")
	cmd.PersistentFlags().StringVarP(&opts.output, "output", "o", opts.output, "Output format: pretty|json")

	defaultHelp := cmd.HelpFunc()
	cmd.SetHelpFunc(func(c *cobra.Command, args []string) {
		// Only the root help is "verbose by design"; subcommands keep standard Cobra help.
		if c != cmd {
			defaultHelp(c, args)
			return
		}

		out := c.OutOrStdout()
		baseURL := readStringFlag(c, "base-url")
		configPath := readStringFlag(c, "config")
		output := readStringFlag(c, "output")
		timeout := readDurationFlag(c, "timeout")
		if strings.TrimSpace(baseURL) == "" {
			baseURL = "<from config>"
		}
		if strings.TrimSpace(configPath) == "" {
			configPath = "<auto-discover: config/global.yaml>"
		}

		fmt.Fprintln(out, "WHERE YOU ARE")
		fmt.Fprintln(out, "  - You are in the developer console (roomctl).")
		fmt.Fprintf(out, "  - You are talking to roomd at: %s\n", baseURL)
		fmt.Fprintf(out, "  - Config path: %s\n", configPath)
		fmt.Fprintf(out, "  - Output mode: %s\n", output)
		fmt.Fprintf(out, "  - Timeout: %s\n", timeout)
		fmt.Fprintln(out, "  - The user lives in the browser host (host-web). You do not render UI here.")
		fmt.Fprintln(out)

		fmt.Fprintln(out, "WHY YOU'RE HERE")
		fmt.Fprintln(out, "  - roomd is a runtime that mounts MCP servers into persistent rooms and proxies standardized MCP calls.")
		fmt.Fprintln(out, "  - Your role is to operate room state (mount/unmount/layout/visibility) and invoke tools/resources/prompts through instances.")
		fmt.Fprintln(out, "  - Instances may be UI-backed or headless; UI is optional, tools are not.")
		fmt.Fprintln(out)

		fmt.Fprintln(out, "MENTAL MODEL")
		fmt.Fprintln(out, "  - room: persistent container ID (e.g. {{room}})")
		fmt.Fprintln(out, "  - instance: stable mount ID inside a room (e.g. {{instance}})")
		fmt.Fprintln(out, "  - server: upstream MCP endpoint (http(s)://.../mcp or stdio://...)")
		fmt.Fprintln(out, "  - container: grid slot x,y,w,h (e.g. {{x}},{{y}},{{w}},{{h}})")
		fmt.Fprintln(out, "  - inspect: discover tools + UI candidates before mount")
		fmt.Fprintln(out, "  - state: source of truth for mounts, order, selection, and invocation history")
		fmt.Fprintln(out)

		fmt.Fprintln(out, "FAST PATH (IF YOU JUST APPEARED HERE)")
		fmt.Fprintln(out, "  1. roomctl health")
		fmt.Fprintln(out, "  2. roomctl inspect --server {{server}}")
		fmt.Fprintln(out, "  3. roomctl create --room {{room}}")
		fmt.Fprintln(out, "  4. roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}} [--ui-resource-uri {{ui-resource-uri}}]")
		fmt.Fprintln(out, "  5. roomctl list-tools --room {{room}} --instance {{instance}}")
		fmt.Fprintln(out, "  6. roomctl tool-call --room {{room}} --instance {{instance}} --name {{tool}} --arguments {{arguments-json}}")
		fmt.Fprintln(out, "  7. roomctl state --room {{room}}")
		fmt.Fprintln(out)

		fmt.Fprintln(out, "DEV OVERRIDES (LOCAL ONLY)")
		fmt.Fprintln(out, "  - roomd enforces security policies (stdio allowlist, remote HTTP restrictions, auth).")
		fmt.Fprintln(out, "  - For local iteration you can relax policies via DANGEROUSLY_ALLOW_* flags (never for production).")
		fmt.Fprintln(out, "  - Common: DANGEROUSLY_ALLOW_STDIO, DANGEROUSLY_ALLOW_REMOTE_HTTP, DANGEROUSLY_ALLOW_SANDBOX (host-side)")
		fmt.Fprintln(out)

		fmt.Fprintln(out, "WHEN THINGS FAIL")
		fmt.Fprintln(out, "  - roomctl prints typed error codes (e.g. error [UNSUPPORTED_CAPABILITY]) and may include hint/details.")
		fmt.Fprintln(out, "  - JSON responses are enriched with body.suggestions[] = { cmd, description } using placeholders like {{room}}.")
		fmt.Fprintln(out)

		defaultHelp(c, args)
	})

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
		newInstancePromptsGetCmd(opts),
		newInstanceCompleteCmd(opts),
		newInstanceResourceSubscribeCmd(opts),
		newInstanceResourceUnsubscribeCmd(opts),
		newSelectCmd(opts),
		newReorderCmd(opts),
		newLayoutCmd(opts),
	)

	return cmd
}

func readStringFlag(cmd *cobra.Command, name string) string {
	value, err := cmd.Flags().GetString(name)
	if err == nil && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	value, err = cmd.PersistentFlags().GetString(name)
	if err == nil && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return ""
}

func readDurationFlag(cmd *cobra.Command, name string) time.Duration {
	value, err := cmd.Flags().GetDuration(name)
	if err == nil && value > 0 {
		return value
	}
	value, err = cmd.PersistentFlags().GetDuration(name)
	if err == nil && value > 0 {
		return value
	}
	return 0
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

	cmd.Flags().StringVar(&server, "server", "", "Upstream MCP server URL or stdio descriptor")
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
				return client.Command(ctx, roomID, resolveIdempotencyKey(idempotencyKey), command)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&server, "server", "", "Upstream MCP server URL or stdio descriptor")
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
	cmd.Aliases = []string{"list-tools"}

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

func newInstancePromptsGetCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var name string
	var arguments string

	cmd := &cobra.Command{
		Use:   "prompts-get --room <room-id> --instance <instance-id> --name <prompt-name> [--arguments '{\"k\":\"v\"}']",
		Short: "Get a prompt from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			object, err := parse.JSONObject(arguments)
			if err != nil {
				return err
			}

			stringArgs, err := mapStringAnyToString(object)
			if err != nil {
				return err
			}

			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstancePromptGet(ctx, roomID, instanceID, name, stringArgs)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&name, "name", "", "Prompt name")
	cmd.Flags().StringVar(&arguments, "arguments", "{}", "Prompt arguments as JSON object with string values")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("name")
	return cmd
}

func newInstanceCompleteCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var params string

	cmd := &cobra.Command{
		Use:   "complete --room <room-id> --instance <instance-id> --params '{\"ref\":{\"type\":\"ref/prompt\",\"name\":\"p\"},\"argument\":{\"name\":\"q\",\"value\":\"he\"}}'",
		Short: "Request completion options from a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			object, err := parse.JSONObject(params)
			if err != nil {
				return err
			}
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceComplete(ctx, roomID, instanceID, object)
			})
		},
	}

	cmd.Flags().StringVar(&roomID, "room", "", "Room ID")
	cmd.Flags().StringVar(&instanceID, "instance", "", "Mount instance ID")
	cmd.Flags().StringVar(&params, "params", "", "Completion params as JSON object")
	_ = cmd.MarkFlagRequired("room")
	_ = cmd.MarkFlagRequired("instance")
	_ = cmd.MarkFlagRequired("params")
	return cmd
}

func newInstanceResourceSubscribeCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var uri string

	cmd := &cobra.Command{
		Use:   "resources-subscribe --room <room-id> --instance <instance-id> --uri <uri>",
		Short: "Subscribe to resource updates for a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceResourceSubscribe(ctx, roomID, instanceID, uri)
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

func newInstanceResourceUnsubscribeCmd(opts *rootOptions) *cobra.Command {
	var roomID string
	var instanceID string
	var uri string

	cmd := &cobra.Command{
		Use:   "resources-unsubscribe --room <room-id> --instance <instance-id> --uri <uri>",
		Short: "Unsubscribe from resource updates for a mounted instance",
		RunE: func(_ *cobra.Command, _ []string) error {
			return runWithClient(opts, func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error) {
				return client.InstanceResourceUnsubscribe(ctx, roomID, instanceID, uri)
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

func mapStringAnyToString(values map[string]any) (map[string]string, error) {
	result := make(map[string]string, len(values))
	for key, value := range values {
		asString, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("expected string value for key %q", key)
		}
		result[key] = asString
	}
	return result, nil
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

func enrichEnvelopeWithSuggestions(command string, env roomd.Envelope) roomd.Envelope {
	body, ok := env.Body.(map[string]any)
	if !ok {
		return env
	}

	suggestions := suggestionsFor(command, env)
	if len(suggestions) == 0 {
		return env
	}

	copied := make(map[string]any, len(body)+1)
	for key, value := range body {
		copied[key] = value
	}
	copied["suggestions"] = suggestions
	env.Body = copied
	return env
}

func suggestionsFor(command string, env roomd.Envelope) []suggestion {
	code := envelopeErrorCode(env)

	if code == "ROOM_EXISTS" {
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Use the existing room and inspect current state.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Proceed by mounting an instance into the existing room.",
			},
		}
	}

	if code == "ROOM_NOT_FOUND" {
		return []suggestion{
			{
				Cmd:         "roomctl create --room {{room}}",
				Description: "Create the room before running room-scoped commands.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Retry mount after the room exists.",
			},
		}
	}

	if code == "INSTANCE_EXISTS" {
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Confirm the existing instance and current layout before remounting.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Retry with a new instance ID if another mount is required.",
			},
		}
	}

	if code == "INSTANCE_NOT_FOUND" {
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "List mounted instances and verify the instance ID.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Mount the instance if it does not exist yet.",
			},
		}
	}

	if code == "IDEMPOTENCY_CONFLICT" {
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Check whether the original command already applied.",
			},
			{
				Cmd:         "roomctl state-get --room {{room}} --path state.revision",
				Description: "Compare room revision before deciding whether to retry the write.",
			},
		}
	}

	if code == "UNSUPPORTED_CAPABILITY" {
		return []suggestion{
			{
				Cmd:         "roomctl capabilities --room {{room}} --instance {{instance}}",
				Description: "Check negotiated capabilities before invoking gated endpoints.",
			},
			{
				Cmd:         "roomctl list-tools --room {{room}} --instance {{instance}}",
				Description: "Fallback to tools exposed by this instance when a primitive is unavailable.",
			},
		}
	}

	if code == "INVALID_PAYLOAD" || code == "INVALID_COMMAND" {
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Inspect current state to verify valid instance IDs and layout fields.",
			},
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Re-check server metadata before retrying with corrected arguments.",
			},
		}
	}

	if code == "NO_UI_RESOURCE" || code == "UI_RESOURCE_INVALID" {
		return []suggestion{
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Discover UI candidates exposed by the server.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}} --ui-resource-uri {{ui-resource-uri}}",
				Description: "Retry mount with a valid UI resource URI from inspect output.",
			},
		}
	}

	if code == "AUTH_REQUIRED" || code == "AUTH_FAILED" || code == "AUTH_DISCOVERY_FAILED" {
		return []suggestion{
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Inspect auth requirements and transport metadata for this server.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Retry mount after supplying required credentials or auth policy.",
			},
		}
	}

	if code == "SERVER_NOT_ALLOWLISTED" {
		return []suggestion{
			{
				Cmd:         "npm run roomd:start",
				Description: "Restart roomd using global config security.profile=local-dev for permissive local mounts.",
			},
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Verify descriptor parsing before attempting another mount.",
			},
		}
	}

	if code == "UPSTREAM_TRANSPORT_ERROR" {
		return []suggestion{
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Confirm the upstream MCP endpoint is reachable and protocol-compliant.",
			},
			{
				Cmd:         "roomctl health",
				Description: "Verify roomd itself is healthy before retrying.",
			},
		}
	}

	if code == "ROOMD_UNREACHABLE" {
		return []suggestion{
			{
				Cmd:         "npm run roomd:start",
				Description: "Start roomd when it is not listening at the configured base URL.",
			},
			{
				Cmd:         "roomctl health",
				Description: "Retry health after roomd is running.",
			},
		}
	}

	if code == "ROOMD_TIMEOUT" {
		return []suggestion{
			{
				Cmd:         "roomctl health --timeout {{timeout}}",
				Description: "Retry with a larger timeout for slow environments.",
			},
			{
				Cmd:         "roomctl inspect --server {{server}} --timeout {{timeout}}",
				Description: "Re-run inspect with an explicit timeout value.",
			},
		}
	}

	if code == "INVALID_BASE_URL" {
		return []suggestion{
			{
				Cmd:         "roomctl health --base-url {{base-url}}",
				Description: "Use a valid roomd URL including scheme and host.",
			},
		}
	}

	if code == "ROOMD_CLIENT_ERROR" || code == "INTERNAL_ERROR" {
		return []suggestion{
			{
				Cmd:         "roomctl health",
				Description: "Confirm roomd is reachable and responding.",
			},
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Retry with a known-good MCP endpoint after verifying health.",
			},
		}
	}

	switch command {
	case "health":
		return []suggestion{
			{
				Cmd:         "roomctl inspect --server {{server}}",
				Description: "Inspect an MCP endpoint to discover tools and UI candidates.",
			},
			{
				Cmd:         "roomctl create --room {{room}}",
				Description: "Create a room before mounting instances.",
			},
		}
	case "inspect":
		if env.Status >= 400 {
			return []suggestion{
				{
					Cmd:         "roomctl health",
					Description: "Verify roomd is reachable before retrying inspect.",
				},
				{
					Cmd:         "roomctl inspect --server {{server}}",
					Description: "Retry with a valid MCP endpoint or stdio descriptor.",
				},
			}
		}
		return []suggestion{
			{
				Cmd:         "roomctl create --room {{room}}",
				Description: "Create a room to hold mounted instances.",
			},
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Mount the inspected MCP server into a room grid slot.",
			},
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Verify room state after mounting.",
			},
		}
	case "create":
		return []suggestion{
			{
				Cmd:         "roomctl mount --room {{room}} --instance {{instance}} --server {{server}} --container {{x}},{{y}},{{w}},{{h}}",
				Description: "Mount an MCP server into the newly created room.",
			},
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Inspect current mounts, order, and selected instance.",
			},
		}
	case "mount":
		if env.Status >= 400 {
			return []suggestion{
				{
					Cmd:         "roomctl inspect --server {{server}}",
					Description: "Check server metadata and mountability before retrying.",
				},
				{
					Cmd:         "roomctl state --room {{room}}",
					Description: "Confirm current room mounts and layout.",
				},
			}
		}
		return []suggestion{
			{
				Cmd:         "roomctl list-tools --room {{room}} --instance {{instance}}",
				Description: "List available tools for the mounted instance.",
			},
			{
				Cmd:         "roomctl tool-call --room {{room}} --instance {{instance}} --name {{tool}} --arguments {{arguments-json}}",
				Description: "Execute a tool call through the mounted instance.",
			},
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Verify mount order, selection, and layout.",
			},
		}
	case "state":
		return []suggestion{
			{
				Cmd:         "roomctl state-get --room {{room}} --path state.selectedInstanceId",
				Description: "Read the selected instance from room state.",
			},
			{
				Cmd:         "roomctl state-get --room {{room}} --path state.mounts.0.container",
				Description: "Inspect the first mounted instance container coordinates.",
			},
		}
	case "state-get":
		return []suggestion{
			{
				Cmd:         "roomctl state-get --room {{room}} --path state.selectedInstanceId",
				Description: "Use full response paths rooted at `state`.",
			},
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Inspect full state to discover available paths.",
			},
		}
	case "tools-list":
		return []suggestion{
			{
				Cmd:         "roomctl tool-call --room {{room}} --instance {{instance}} --name {{tool}} --arguments {{arguments-json}}",
				Description: "Call one of the listed tools.",
			},
			{
				Cmd:         "roomctl capabilities --room {{room}} --instance {{instance}}",
				Description: "View negotiated capabilities for this instance.",
			},
		}
	case "tool-call":
		return []suggestion{
			{
				Cmd:         "roomctl list-tools --room {{room}} --instance {{instance}}",
				Description: "Re-check tool names and schemas before another call.",
			},
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Review invocation status history in room state.",
			},
		}
	case "capabilities":
		return []suggestion{
			{
				Cmd:         "roomctl list-tools --room {{room}} --instance {{instance}}",
				Description: "List tools available on this mounted instance.",
			},
			{
				Cmd:         "roomctl resources-list --room {{room}} --instance {{instance}}",
				Description: "List resources if resource capability is available.",
			},
		}
	case "resources-list":
		return []suggestion{
			{
				Cmd:         "roomctl resources-read --room {{room}} --instance {{instance}} --uri {{uri}}",
				Description: "Read a resource returned by resources/list.",
			},
			{
				Cmd:         "roomctl resource-templates-list --room {{room}} --instance {{instance}}",
				Description: "List URI templates when concrete resources require parameters.",
			},
		}
	case "resources-read":
		return []suggestion{
			{
				Cmd:         "roomctl resources-list --room {{room}} --instance {{instance}}",
				Description: "List resources again to select another URI.",
			},
		}
	case "resource-templates-list":
		return []suggestion{
			{
				Cmd:         "roomctl resources-read --room {{room}} --instance {{instance}} --uri {{uri}}",
				Description: "Read a concrete URI resolved from one of the listed templates.",
			},
		}
	case "prompts-list":
		return []suggestion{
			{
				Cmd:         "roomctl prompts-get --room {{room}} --instance {{instance}} --name {{prompt}} --arguments {{arguments-json}}",
				Description: "Resolve one of the listed prompts.",
			},
		}
	case "prompts-get":
		return []suggestion{
			{
				Cmd:         "roomctl complete --room {{room}} --instance {{instance}} --params {{params-json}}",
				Description: "Request completion options for prompt arguments.",
			},
		}
	case "complete":
		return []suggestion{
			{
				Cmd:         "roomctl prompts-get --room {{room}} --instance {{instance}} --name {{prompt}} --arguments {{arguments-json}}",
				Description: "Fetch prompt output with explicit argument values.",
			},
		}
	case "resources-subscribe", "resources-unsubscribe":
		return []suggestion{
			{
				Cmd:         "roomctl resources-list --room {{room}} --instance {{instance}}",
				Description: "List resources to verify valid subscription URIs.",
			},
		}
	case "hide", "show", "select", "reorder", "layout", "unmount":
		return []suggestion{
			{
				Cmd:         "roomctl state --room {{room}}",
				Description: "Verify room state after lifecycle or layout changes.",
			},
		}
	default:
		return nil
	}
}

func envelopeErrorCode(env roomd.Envelope) string {
	body, ok := env.Body.(map[string]any)
	if !ok {
		return ""
	}

	code, _ := body["code"].(string)
	return strings.TrimSpace(code)
}

func runWithClient(opts *rootOptions, run func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error)) error {
	if opts.timeout <= 0 {
		return errors.New("--timeout must be > 0")
	}

	client, err := roomd.NewClient(opts.baseURL, opts.timeout)
	if err != nil {
		envelope := enrichEnvelopeWithSuggestions(opts.command, envelopeForClientError(err))
		return printEnvelope(opts.stdout, opts.output, envelope)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	envelope, err := run(ctx, client)
	if err != nil {
		failure := enrichEnvelopeWithSuggestions(opts.command, envelopeForClientError(err))
		return printEnvelope(opts.stdout, opts.output, failure)
	}

	envelope = enrichEnvelopeWithSuggestions(opts.command, envelope)

	return printEnvelope(opts.stdout, opts.output, envelope)
}

func envelopeForClientError(err error) roomd.Envelope {
	message := strings.TrimSpace(err.Error())
	status := 502
	code := "ROOMD_CLIENT_ERROR"
	userMessage := "roomctl request failed"

	switch {
	case strings.Contains(message, "base URL"):
		status = 400
		code = "INVALID_BASE_URL"
		userMessage = "roomctl base URL is invalid"
	case strings.Contains(message, "connection refused"):
		status = 503
		code = "ROOMD_UNREACHABLE"
		userMessage = "roomd is not reachable at the configured base URL"
	case strings.Contains(message, "i/o timeout"), strings.Contains(message, "context deadline exceeded"):
		status = 504
		code = "ROOMD_TIMEOUT"
		userMessage = "roomd request timed out"
	}

	return roomd.Envelope{
		Status: status,
		Body: map[string]any{
			"ok":      false,
			"code":    code,
			"error":   userMessage,
			"details": map[string]any{"cause": message},
		},
	}
}

func printEnvelope(out io.Writer, format string, envelope roomd.Envelope) error {
	if format == "pretty" && envelope.Status >= 400 {
		if body, ok := envelope.Body.(map[string]any); ok {
			if printPrettyError(out, envelope.Status, body) {
				printPrettySuggestions(out, body)
				return nil
			}
		}
	}

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

func printPrettySuggestions(out io.Writer, body map[string]any) {
	entries, ok := body["suggestions"]
	if !ok || entries == nil {
		return
	}

	suggestions := parseSuggestions(entries)
	if len(suggestions) == 0 {
		return
	}

	_, _ = fmt.Fprintln(out, "suggested next steps:")
	for _, item := range suggestions {
		if strings.TrimSpace(item.Cmd) == "" {
			continue
		}
		if strings.TrimSpace(item.Description) == "" {
			_, _ = fmt.Fprintf(out, "  - %s\n", item.Cmd)
			continue
		}
		_, _ = fmt.Fprintf(out, "  - %s  # %s\n", item.Cmd, item.Description)
	}
}

func parseSuggestions(raw any) []suggestion {
	switch typed := raw.(type) {
	case []suggestion:
		return typed
	case []any:
		result := make([]suggestion, 0, len(typed))
		for _, entry := range typed {
			asMap, ok := entry.(map[string]any)
			if !ok {
				continue
			}
			cmd, _ := asMap["cmd"].(string)
			description, _ := asMap["description"].(string)
			if strings.TrimSpace(cmd) == "" {
				continue
			}
			result = append(result, suggestion{
				Cmd:         cmd,
				Description: description,
			})
		}
		return result
	default:
		return nil
	}
}

func printPrettyError(out io.Writer, status int, body map[string]any) bool {
	message, _ := body["error"].(string)
	if strings.TrimSpace(message) == "" {
		return false
	}

	code, _ := body["code"].(string)
	if strings.TrimSpace(code) == "" {
		code = "UNKNOWN_ERROR"
	}

	_, _ = fmt.Fprintf(out, "error [%s] (%d): %s\n", code, status, message)

	if hint, _ := body["hint"].(string); strings.TrimSpace(hint) != "" {
		_, _ = fmt.Fprintf(out, "hint: %s\n", hint)
	}

	if details, ok := body["details"]; ok && details != nil {
		if encoded, err := json.Marshal(details); err == nil {
			_, _ = fmt.Fprintf(out, "details: %s\n", string(encoded))
		}
	}

	return true
}

func resolveIdempotencyKey(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return uuid.NewString()
}

func commandTitle(value string) string {
	if value == "" {
		return value
	}
	return strings.ToUpper(value[:1]) + value[1:]
}
