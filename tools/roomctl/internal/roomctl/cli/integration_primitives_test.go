package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPromptsGetCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Name      string            `json:"name"`
		Arguments map[string]string `json:"arguments"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"description":"Prompt result","messages":[]}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"prompts-get",
		"--room", "demo",
		"--instance", "inst-1",
		"--name", "debug-prompt",
		"--arguments", `{"topic":"mcp"}`,
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/prompts/get" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/prompts/get", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Name != "debug-prompt" {
		t.Fatalf("name=%q want=debug-prompt", gotBody.Name)
	}
	if gotBody.Arguments["topic"] != "mcp" {
		t.Fatalf("arguments=%v want topic=mcp", gotBody.Arguments)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestCompleteCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"completion":{"values":["hello"]}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"complete",
		"--room", "demo",
		"--instance", "inst-1",
		"--params", `{"ref":{"type":"ref/prompt","name":"debug-prompt"},"argument":{"name":"query","value":"hel"},"context":{"arguments":{"topic":"mcp"}}}`,
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/completion/complete" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/completion/complete", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	ref, ok := gotBody["ref"].(map[string]any)
	if !ok || ref["type"] != "ref/prompt" || ref["name"] != "debug-prompt" {
		t.Fatalf("ref=%v want ref/prompt debug-prompt", gotBody["ref"])
	}
	argument, ok := gotBody["argument"].(map[string]any)
	if !ok || argument["name"] != "query" || argument["value"] != "hel" {
		t.Fatalf("argument=%v want query=hel", gotBody["argument"])
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestResourcesSubscribeCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		URI string `json:"uri"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"resources-subscribe",
		"--room", "demo",
		"--instance", "inst-1",
		"--uri", "file://notes.md",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/resources/subscribe" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/resources/subscribe", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.URI != "file://notes.md" {
		t.Fatalf("uri=%q want=file://notes.md", gotBody.URI)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestResourcesUnsubscribeCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		URI string `json:"uri"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"resources-unsubscribe",
		"--room", "demo",
		"--instance", "inst-1",
		"--uri", "file://notes.md",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/resources/unsubscribe" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/resources/unsubscribe", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.URI != "file://notes.md" {
		t.Fatalf("uri=%q want=file://notes.md", gotBody.URI)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}
