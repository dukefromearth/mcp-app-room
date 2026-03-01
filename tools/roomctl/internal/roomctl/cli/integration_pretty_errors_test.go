package cli

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPrettyOutputShowsErrorCodeAndHint(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"error":"Server does not support resources required by resources/read","code":"UNSUPPORTED_CAPABILITY","hint":"Check /instances/:instanceId/capabilities before calling this endpoint.","details":{"capability":"resources","operation":"resources/read"}}`))
	}))
	defer server.Close()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: server.URL,
		timeout: 2 * time.Second,
		output:  "pretty",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{
		"inspect",
		"--server", "http://localhost:3001/mcp",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v", err)
	}

	rendered := stdout.String()
	if !strings.Contains(rendered, "error [UNSUPPORTED_CAPABILITY]") {
		t.Fatalf("missing error code in output: %s", rendered)
	}
	if !strings.Contains(rendered, "hint: Check /instances/:instanceId/capabilities") {
		t.Fatalf("missing hint in output: %s", rendered)
	}
	if !strings.Contains(rendered, `"operation":"resources/read"`) {
		t.Fatalf("missing details in output: %s", rendered)
	}
}

func TestPrettyOutputShowsSuggestions(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"ok":false,"error":"Room not found: demo","code":"ROOM_NOT_FOUND"}`))
	}))
	defer server.Close()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: server.URL,
		timeout: 2 * time.Second,
		output:  "pretty",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{
		"mount",
		"--room", "demo",
		"--instance", "inst-1",
		"--server", "http://localhost:3001/mcp",
		"--container", "0,0,4,4",
	})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v", err)
	}

	rendered := stdout.String()
	if !strings.Contains(rendered, "suggested next steps:") {
		t.Fatalf("missing suggestion header in output: %s", rendered)
	}
	if !strings.Contains(rendered, "roomctl create --room {{room}}") {
		t.Fatalf("missing create suggestion in output: %s", rendered)
	}
}

func TestPrettyOutputShowsTransportSuggestions(t *testing.T) {
	t.Parallel()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: "localhost:8090",
		timeout: 2 * time.Second,
		output:  "pretty",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"health"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v", err)
	}

	rendered := stdout.String()
	if !strings.Contains(rendered, "error [INVALID_BASE_URL]") {
		t.Fatalf("missing transport error code in output: %s", rendered)
	}
	if !strings.Contains(rendered, "suggested next steps:") {
		t.Fatalf("missing suggestion header in output: %s", rendered)
	}
	if !strings.Contains(rendered, "roomctl health --base-url {{base-url}}") {
		t.Fatalf("missing base-url suggestion in output: %s", rendered)
	}
}
