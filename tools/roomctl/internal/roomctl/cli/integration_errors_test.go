package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthUnreachableReturnsStructuredEnvelope(t *testing.T) {
	t.Parallel()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: "http://127.0.0.1:1",
		timeout: 500 * time.Millisecond,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"health"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v; stderr=%s", err, strings.TrimSpace(stderr.String()))
	}

	var env map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &env); err != nil {
		t.Fatalf("decode command output: %v, output=%s", err, stdout.String())
	}
	if int(env["status"].(float64)) != http.StatusServiceUnavailable {
		t.Fatalf("status=%v want=%d", env["status"], http.StatusServiceUnavailable)
	}

	body := env["body"].(map[string]any)
	if body["code"] != "ROOMD_UNREACHABLE" {
		t.Fatalf("code=%v want=ROOMD_UNREACHABLE", body["code"])
	}
	suggestions := requireSuggestions(t, body)
	if suggestions[0].Cmd != "npm run roomd:start" {
		t.Fatalf("unexpected first suggestion cmd=%q", suggestions[0].Cmd)
	}
}

func TestHealthInvalidBaseURLReturnsStructuredEnvelope(t *testing.T) {
	t.Parallel()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: "localhost:8090",
		timeout: 2 * time.Second,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"health"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v; stderr=%s", err, strings.TrimSpace(stderr.String()))
	}

	var env map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &env); err != nil {
		t.Fatalf("decode command output: %v, output=%s", err, stdout.String())
	}
	if int(env["status"].(float64)) != http.StatusBadRequest {
		t.Fatalf("status=%v want=%d", env["status"], http.StatusBadRequest)
	}

	body := env["body"].(map[string]any)
	if body["code"] != "INVALID_BASE_URL" {
		t.Fatalf("code=%v want=INVALID_BASE_URL", body["code"])
	}
	suggestions := requireSuggestions(t, body)
	if suggestions[0].Cmd != "roomctl health --base-url {{base-url}}" {
		t.Fatalf("unexpected first suggestion cmd=%q", suggestions[0].Cmd)
	}
}

func TestResourcesListSuccessIncludesTemplateSuggestion(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"resources":[{"uri":"file://notes.md"}]}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"resources-list",
		"--room", "demo",
		"--instance", "inst-1",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected resources-list suggestions, got=%v", suggestions)
	}
	if suggestions[1].Cmd != "roomctl resource-templates-list --room {{room}} --instance {{instance}}" {
		t.Fatalf("unexpected second resources-list suggestion cmd=%q", suggestions[1].Cmd)
	}
}

func TestPromptsGetUnsupportedCapabilitySuggestions(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"code":"UNSUPPORTED_CAPABILITY","error":"Server does not support prompts/get"}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"prompts-get",
		"--room", "demo",
		"--instance", "inst-1",
		"--name", "summarize",
		"--arguments", `{"topic":"mcp"}`,
	)

	if env.Status != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusBadRequest)
	}

	suggestions := requireSuggestions(t, env.Body)
	if suggestions[0].Cmd != "roomctl capabilities --room {{room}} --instance {{instance}}" {
		t.Fatalf("unexpected first UNSUPPORTED_CAPABILITY suggestion cmd=%q", suggestions[0].Cmd)
	}
}
