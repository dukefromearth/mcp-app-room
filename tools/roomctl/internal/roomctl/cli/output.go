package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

type suggestion struct {
	Cmd         string `json:"cmd"`
	Description string `json:"description"`
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
