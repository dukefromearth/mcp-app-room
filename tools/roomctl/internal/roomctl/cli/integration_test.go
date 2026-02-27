package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func TestCreateCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		RoomID string `json:"roomId"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true,"state":{"roomId":"demo"}}`))
	}))
	defer server.Close()

	env := runCommand(t, server.URL, "create", "--room", "demo")

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms" {
		t.Fatalf("path=%s want=/rooms", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.RoomID != "demo" {
		t.Fatalf("roomId=%q want=demo", gotBody.RoomID)
	}

	if env.Status != http.StatusCreated {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusCreated)
	}
}

func TestMountCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		IdempotencyKey string `json:"idempotencyKey"`
		Command        struct {
			Type       string         `json:"type"`
			InstanceID string         `json:"instanceId"`
			Server     string         `json:"server"`
			ToolName   string         `json:"toolName"`
			Container  map[string]int `json:"container"`
			Initial    map[string]any `json:"initialInput"`
		} `json:"command"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"revision":2}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"mount",
		"--room", "demo",
		"--instance", "inst-1",
		"--server", "http://localhost:3001/mcp",
		"--tool", "get-time",
		"--container", "0,0,4,4",
		"--input", `{"tz":"UTC"}`,
		"--idempotency-key", "idem-1",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/commands" {
		t.Fatalf("path=%s want=/rooms/demo/commands", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.IdempotencyKey != "idem-1" {
		t.Fatalf("idempotencyKey=%q want=idem-1", gotBody.IdempotencyKey)
	}
	if gotBody.Command.Type != "mount" {
		t.Fatalf("command.type=%q want=mount", gotBody.Command.Type)
	}
	if gotBody.Command.InstanceID != "inst-1" {
		t.Fatalf("instanceId=%q want=inst-1", gotBody.Command.InstanceID)
	}
	if gotBody.Command.Container["x"] != 0 || gotBody.Command.Container["y"] != 0 || gotBody.Command.Container["w"] != 4 || gotBody.Command.Container["h"] != 4 {
		t.Fatalf("container=%v want x=0 y=0 w=4 h=4", gotBody.Command.Container)
	}
	if gotBody.Command.Initial["tz"] != "UTC" {
		t.Fatalf("initialInput=%v want tz=UTC", gotBody.Command.Initial)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestReorderCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		IdempotencyKey string `json:"idempotencyKey"`
		Command        struct {
			Type  string   `json:"type"`
			Order []string `json:"order"`
		} `json:"command"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"revision":5}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"reorder",
		"--room", "demo",
		"--order", "inst-1,inst-2",
		"--order", "inst-3",
		"--idempotency-key", "idem-2",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/commands" {
		t.Fatalf("path=%s want=/rooms/demo/commands", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Command.Type != "reorder" {
		t.Fatalf("command.type=%q want=reorder", gotBody.Command.Type)
	}
	wantOrder := []string{"inst-1", "inst-2", "inst-3"}
	if len(gotBody.Command.Order) != len(wantOrder) {
		t.Fatalf("order=%v want=%v", gotBody.Command.Order, wantOrder)
	}
	for i := range wantOrder {
		if gotBody.Command.Order[i] != wantOrder[i] {
			t.Fatalf("order[%d]=%q want=%q", i, gotBody.Command.Order[i], wantOrder[i])
		}
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestLayoutCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		IdempotencyKey string `json:"idempotencyKey"`
		Command        struct {
			Type    string                   `json:"type"`
			Adapter string                   `json:"adapter"`
			Ops     []map[string]interface{} `json:"ops"`
		} `json:"command"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"revision":6}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"layout",
		"--room", "demo",
		"--adapter", "grid12",
		"--ops", `[{"op":"swap","first":"inst-1","second":"inst-2"}]`,
		"--idempotency-key", "idem-layout",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/commands" {
		t.Fatalf("path=%s want=/rooms/demo/commands", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Command.Type != "layout" {
		t.Fatalf("command.type=%q want=layout", gotBody.Command.Type)
	}
	if gotBody.Command.Adapter != "grid12" {
		t.Fatalf("command.adapter=%q want=grid12", gotBody.Command.Adapter)
	}
	if len(gotBody.Command.Ops) != 1 {
		t.Fatalf("ops length=%d want=1", len(gotBody.Command.Ops))
	}
	if gotBody.Command.Ops[0]["op"] != "swap" {
		t.Fatalf("first op=%v want=swap", gotBody.Command.Ops[0]["op"])
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestToolCallCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":{"value":1}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"tool-call",
		"--room", "demo",
		"--instance", "inst-1",
		"--name", "video_get_state",
		"--arguments", `{"sessionId":"s-1"}`,
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/tools/call" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/tools/call", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Name != "video_get_state" {
		t.Fatalf("name=%q want=video_get_state", gotBody.Name)
	}
	if gotBody.Arguments["sessionId"] != "s-1" {
		t.Fatalf("arguments=%v want sessionId=s-1", gotBody.Arguments)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestStateGetCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"invocations":[{"result":{"structuredContent":{"sessionId":"abc-123"}}}]}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"state-get",
		"--room", "demo",
		"--path", "state.invocations.0.result.structuredContent.sessionId",
	)

	if gotMethod != http.MethodGet {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodGet)
	}
	if gotPath != "/rooms/demo/state" {
		t.Fatalf("path=%s want=/rooms/demo/state", gotPath)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}

	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["path"] != "state.invocations.0.result.structuredContent.sessionId" {
		t.Fatalf("path=%v", body["path"])
	}
	if body["found"] != true {
		t.Fatalf("found=%v want=true", body["found"])
	}
	if body["value"] != "abc-123" {
		t.Fatalf("value=%v want=abc-123", body["value"])
	}
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
