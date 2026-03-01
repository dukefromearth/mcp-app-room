package cli

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

type testSuggestion struct {
	Cmd         string
	Description string
}

func runCommand(t *testing.T, baseURL string, args ...string) roomd.Envelope {
	t.Helper()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: baseURL,
		timeout: 2 * time.Second,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs(args)

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v; stderr=%s", err, strings.TrimSpace(stderr.String()))
	}

	var env roomd.Envelope
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &env); err != nil {
		t.Fatalf("decode command output: %v, output=%s", err, stdout.String())
	}

	return env
}

func requireSuggestions(t *testing.T, body any) []testSuggestion {
	t.Helper()

	asMap, ok := body.(map[string]any)
	if !ok {
		t.Fatalf("expected map body, got %T", body)
	}

	raw, ok := asMap["suggestions"]
	if !ok {
		t.Fatalf("missing suggestions in response body: %v", asMap)
	}

	rawList, ok := raw.([]any)
	if !ok {
		t.Fatalf("expected suggestions to be []any, got %T", raw)
	}

	result := make([]testSuggestion, 0, len(rawList))
	for _, item := range rawList {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		cmd, _ := entry["cmd"].(string)
		description, _ := entry["description"].(string)
		if strings.TrimSpace(cmd) == "" {
			continue
		}
		result = append(result, testSuggestion{
			Cmd:         cmd,
			Description: description,
		})
	}

	if len(result) == 0 {
		t.Fatalf("suggestions present but empty: %v", raw)
	}

	return result
}
