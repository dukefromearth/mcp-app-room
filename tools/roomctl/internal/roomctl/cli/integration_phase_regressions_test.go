package cli

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAwaitCommandIntegrationMatchesWhenCurrentPhaseIsBeyondTarget(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":7,"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"app_initialized","seq":3,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--instance", "inst-1",
		"--phase", "resource_delivered",
		"--poll-interval", "10ms",
		"--max-wait", "100ms",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestToolCallRequirePhaseMissingUsesLatestObservedPhase(t *testing.T) {
	t.Parallel()

	stateCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rooms/demo/instances/inst-1/tools/call":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"content":[{"type":"text","text":"done"}]}`))
		case "/rooms/demo/state":
			stateCalls++
			w.Header().Set("content-type", "application/json")
			if stateCalls <= 2 {
				_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[]}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":11,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"bridge_connected","seq":1,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
		}
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"tool-call",
		"--room", "demo",
		"--instance", "inst-1",
		"--name", "demo",
		"--arguments", `{}`,
		"--phase", "app_initialized",
		"--phase-poll-interval", "5ms",
		"--phase-max-wait", "30ms",
	)

	if env.Status != http.StatusPreconditionFailed {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusPreconditionFailed)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details=%T want map", body["details"])
	}
	if details["currentPhase"] != "bridge_connected" {
		t.Fatalf("currentPhase=%v want=bridge_connected", details["currentPhase"])
	}
}
