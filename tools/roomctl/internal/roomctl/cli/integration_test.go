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
			Type          string         `json:"type"`
			InstanceID    string         `json:"instanceId"`
			Server        string         `json:"server"`
			Container     map[string]int `json:"container"`
			UIResourceURI string         `json:"uiResourceUri"`
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
		"--container", "0,0,4,4",
		"--ui-resource-uri", "ui://markdown/mcp-app.html",
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
	if gotBody.Command.UIResourceURI != "ui://markdown/mcp-app.html" {
		t.Fatalf("uiResourceUri=%q want=ui://markdown/mcp-app.html", gotBody.Command.UIResourceURI)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestInspectCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Server string `json:"server"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"server":"http://localhost:3114/mcp","tools":[{"name":"read"}],"uiCandidates":["ui://markdown/mcp-app.html"],"autoMountable":true,"recommendedUiResourceUri":"ui://markdown/mcp-app.html","exampleCommands":["roomctl mount --room <room-id> --instance <instance-id> --server http://localhost:3114/mcp --container 0,0,4,12"]}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"inspect",
		"--server", "http://localhost:3114/mcp",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/inspect/server" {
		t.Fatalf("path=%s want=/inspect/server", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Server != "http://localhost:3114/mcp" {
		t.Fatalf("server=%q want=http://localhost:3114/mcp", gotBody.Server)
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

func TestToolsListCommandIntegration(t *testing.T) {
	t.Parallel()

	var gotMethod string
	var gotPath string
	var decodeErr error
	var gotBody struct {
		Cursor string `json:"cursor"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"tools":[{"name":"read"}]}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"tools-list",
		"--room", "demo",
		"--instance", "inst-1",
		"--cursor", "next-page",
	)

	if gotMethod != http.MethodPost {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
	}
	if gotPath != "/rooms/demo/instances/inst-1/tools/list" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/tools/list", gotPath)
	}
	if decodeErr != nil {
		t.Fatalf("decode request body: %v", decodeErr)
	}
	if gotBody.Cursor != "next-page" {
		t.Fatalf("cursor=%q want=next-page", gotBody.Cursor)
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
