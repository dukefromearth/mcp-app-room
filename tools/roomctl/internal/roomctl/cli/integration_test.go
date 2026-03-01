package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected mount suggestions, got=%v", suggestions)
	}
	if suggestions[0].Cmd != "roomctl list-tools --room {{room}} --instance {{instance}}" {
		t.Fatalf("unexpected first mount suggestion cmd=%q", suggestions[0].Cmd)
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

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected inspect suggestions, got=%v", suggestions)
	}
	if suggestions[0].Cmd != "roomctl create --room {{room}}" {
		t.Fatalf("unexpected first inspect suggestion cmd=%q", suggestions[0].Cmd)
	}
}

func TestMountRoomNotFoundSuggestions(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"ok":false,"code":"ROOM_NOT_FOUND","error":"Room not found: demo"}`))
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
	)

	if env.Status != http.StatusNotFound {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusNotFound)
	}

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected ROOM_NOT_FOUND suggestions, got=%v", suggestions)
	}
	if suggestions[0].Cmd != "roomctl create --room {{room}}" {
		t.Fatalf("unexpected first ROOM_NOT_FOUND suggestion cmd=%q", suggestions[0].Cmd)
	}
}

func TestToolsListInstanceNotFoundSuggestions(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"ok":false,"code":"INSTANCE_NOT_FOUND","error":"Instance not found: inst-1"}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"tools-list",
		"--room", "demo",
		"--instance", "inst-1",
	)

	if env.Status != http.StatusNotFound {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusNotFound)
	}

	suggestions := requireSuggestions(t, env.Body)
	if len(suggestions) < 2 {
		t.Fatalf("expected INSTANCE_NOT_FOUND suggestions, got=%v", suggestions)
	}
	if suggestions[0].Cmd != "roomctl state --room {{room}}" {
		t.Fatalf("unexpected first INSTANCE_NOT_FOUND suggestion cmd=%q", suggestions[0].Cmd)
	}
}
