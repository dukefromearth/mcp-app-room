package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoomConfigListCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var gotNamespace string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotNamespace = r.URL.Query().Get("namespace")
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"configs":[{"configId":"banking"}]}`))
	}))
	defer server.Close()

	env := runCommand(t, server.URL, "room-config-list", "--namespace", "team-finance")

	if gotMethod != http.MethodGet {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodGet)
	}
	if gotPath != "/room-configs" {
		t.Fatalf("path=%s want=/room-configs", gotPath)
	}
	if gotNamespace != "team-finance" {
		t.Fatalf("namespace=%q want=team-finance", gotNamespace)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestRoomConfigUpsertCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Namespace  string         `json:"namespace"`
		Visibility string         `json:"visibility"`
		Spec       map[string]any `json:"spec"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"config":{"configId":"banking-room"}}`))
	}))
	defer server.Close()

	spec := `{"schemaVersion":"room-config.v1","instances":[{"instanceId":"ledger","server":"http://localhost:3001/mcp","container":{"x":0,"y":0,"w":6,"h":4}}]}`
	env := runCommand(
		t,
		server.URL,
		"room-config-upsert",
		"--config", "banking-room",
		"--namespace", "default",
		"--visibility", "private",
		"--spec", spec,
	)

	if gotMethod != http.MethodPut {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPut)
	}
	if gotPath != "/room-configs/banking-room" {
		t.Fatalf("path=%s want=/room-configs/banking-room", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Namespace != "default" {
		t.Fatalf("namespace=%q want=default", gotBody.Namespace)
	}
	if gotBody.Visibility != "private" {
		t.Fatalf("visibility=%q want=private", gotBody.Visibility)
	}
	if gotBody.Spec["schemaVersion"] != "room-config.v1" {
		t.Fatalf("spec.schemaVersion=%v want=room-config.v1", gotBody.Spec["schemaVersion"])
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestRoomConfigLoadCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Namespace      string `json:"namespace"`
		RoomID         string `json:"roomId"`
		Mode           string `json:"mode"`
		DryRun         bool   `json:"dryRun"`
		IdempotencyKey string `json:"idempotencyKey"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"applied":false,"dryRun":true}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"room-config-load",
		"--config", "banking-room",
		"--room", "demo",
		"--namespace", "default",
		"--mode", "empty_only",
		"--dry-run",
		"--idempotency-key", "cfg-load-1",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/room-configs/banking-room/load" {
		t.Fatalf("path=%s want=/room-configs/banking-room/load", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.RoomID != "demo" {
		t.Fatalf("roomId=%q want=demo", gotBody.RoomID)
	}
	if gotBody.DryRun != true {
		t.Fatalf("dryRun=%v want=true", gotBody.DryRun)
	}
	if gotBody.IdempotencyKey != "cfg-load-1" {
		t.Fatalf("idempotencyKey=%q want=cfg-load-1", gotBody.IdempotencyKey)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestRoomConfigPlanCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Namespace string `json:"namespace"`
		RoomID    string `json:"roomId"`
		Mode      string `json:"mode"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"plannedCommands":2}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"room-config-plan",
		"--config", "banking-room",
		"--room", "demo",
		"--namespace", "default",
		"--mode", "empty_only",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/room-configs/banking-room/plan" {
		t.Fatalf("path=%s want=/room-configs/banking-room/plan", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.RoomID != "demo" {
		t.Fatalf("roomId=%q want=demo", gotBody.RoomID)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestRoomConfigSaveCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Namespace   string   `json:"namespace"`
		Visibility  string   `json:"visibility"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Tags        []string `json:"tags"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"config":{"configId":"banking-room"}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"room-config-save",
		"--room", "demo",
		"--config", "banking-room",
		"--namespace", "default",
		"--visibility", "shared",
		"--title", "Banking tools",
		"--description", "Payments and ledger",
		"--tags", "finance,payments",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/configs/banking-room/save" {
		t.Fatalf("path=%s want=/rooms/demo/configs/banking-room/save", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Visibility != "shared" {
		t.Fatalf("visibility=%q want=shared", gotBody.Visibility)
	}
	if gotBody.Title != "Banking tools" {
		t.Fatalf("title=%q want=Banking tools", gotBody.Title)
	}
	if len(gotBody.Tags) != 2 {
		t.Fatalf("tags=%v want length 2", gotBody.Tags)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestRoomConfigLoadConfigNotFoundSuggestions(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"ok":false,"code":"CONFIG_NOT_FOUND","error":"Unknown room configuration"}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"room-config-load",
		"--config", "missing",
		"--room", "demo",
		"--namespace", "default",
		"--idempotency-key", "cfg-load-err",
	)

	if env.Status != http.StatusNotFound {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusNotFound)
	}

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected CONFIG_NOT_FOUND suggestions, got=%v", suggestions)
	}
	if !strings.Contains(suggestions[0].Cmd, "room-config-list") {
		t.Fatalf("unexpected first suggestion cmd=%q", suggestions[0].Cmd)
	}
}
