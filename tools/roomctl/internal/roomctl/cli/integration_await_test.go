package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAwaitCommandIntegrationMatchesPhase(t *testing.T) {
	t.Parallel()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		requests++
		w.Header().Set("content-type", "application/json")
		if requests < 3 {
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":5,"lifecycle":{"instances":[]}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":7,"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"app_initialized","seq":3,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--instance", "inst-1",
		"--phase", "app_initialized",
		"--poll-interval", "10ms",
		"--max-wait", "2s",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["phase"] != "app_initialized" {
		t.Fatalf("phase=%v want=app_initialized", body["phase"])
	}
}

func TestAwaitCommandIntegrationTimeout(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":2,"lifecycle":{"instances":[]}}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--phase", "app_initialized",
		"--poll-interval", "5ms",
		"--max-wait", "30ms",
	)

	if env.Status != http.StatusRequestTimeout {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusRequestTimeout)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["code"] != "PHASE_TIMEOUT" {
		t.Fatalf("code=%v want=PHASE_TIMEOUT", body["code"])
	}
}

func TestStateCommandAddsClaimsFromAssurance(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":3,"mounts":[],"order":[],"selectedInstanceId":null,"invocations":[],"lifecycle":{"instances":[]},"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":["Control-plane mount exists and is addressable."],"unknown":["User-visible render completeness is unknown."]}]}}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"state",
		"--room", "demo",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	claims, ok := body["claims"].(map[string]any)
	if !ok {
		encoded, _ := json.Marshal(body)
		t.Fatalf("claims missing in body: %s", encoded)
	}
	proven, ok := claims["proven"].([]any)
	if !ok || len(proven) == 0 {
		t.Fatalf("claims.proven=%v want non-empty", claims["proven"])
	}
}

func TestToolCallRequirePhaseSuccess(t *testing.T) {
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
			if stateCalls == 1 {
				_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[]}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":11,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"app_initialized","seq":3,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
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
		"--phase-max-wait", "200ms",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if _, ok := body["phaseMatch"].(map[string]any); !ok {
		t.Fatalf("expected phaseMatch in body, got=%v", body)
	}
}

func TestToolCallRequirePhaseMissing(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rooms/demo/instances/inst-1/tools/call":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"content":[{"type":"text","text":"done"}]}`))
		case "/rooms/demo/state":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"bridge_connected","seq":1,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
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
	if body["code"] != "REQUIRED_PHASE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_PHASE_MISSING", body["code"])
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details=%T want map", body["details"])
	}
	if details["expectedPhase"] != "app_initialized" {
		t.Fatalf("expectedPhase=%v want=app_initialized", details["expectedPhase"])
	}
	if details["currentPhase"] != "bridge_connected" {
		t.Fatalf("currentPhase=%v want=bridge_connected", details["currentPhase"])
	}
	if strings.TrimSpace(asString(details["recommendedNextCommand"])) == "" {
		t.Fatalf("recommendedNextCommand missing: %v", details)
	}
}

func TestToolCallDefaultsToAwaitForUninitializedUIInstance(t *testing.T) {
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
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[]}}}`))
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
	if body["code"] != "REQUIRED_PHASE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_PHASE_MISSING", body["code"])
	}
	details, _ := body["details"].(map[string]any)
	if details["awaitInferred"] != true {
		t.Fatalf("awaitInferred=%v want=true", details["awaitInferred"])
	}
	if stateCalls < 2 {
		t.Fatalf("stateCalls=%d want>=2 for baseline + polling", stateCalls)
	}
}

func TestToolCallDefaultAwaitIgnoresOtherInstancePhase(t *testing.T) {
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
			if stateCalls == 1 {
				_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[]}}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":11,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[{"instanceId":"inst-2","phase":"app_initialized","seq":3,"sessionId":"sess-2","mountNonce":"mnt-2","updatedAt":"2026-03-01T00:00:00Z"}]}}}`))
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
	if body["code"] != "REQUIRED_PHASE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_PHASE_MISSING", body["code"])
	}
}

func TestReadinessCommandOutputShape(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":12,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"lifecycle":{"instances":[{"instanceId":"inst-1","phase":"resource_delivered","seq":2,"sessionId":"sess-1","mountNonce":"mnt-1","updatedAt":"2026-03-01T00:00:00Z","lastError":"resource warning"}]}}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"readiness",
		"--room", "demo",
		"--instance", "inst-1",
		"--phase", "app_initialized",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["currentPhase"] != "resource_delivered" {
		t.Fatalf("currentPhase=%v want=resource_delivered", body["currentPhase"])
	}
	if body["lastError"] != "resource warning" {
		t.Fatalf("lastError=%v want=resource warning", body["lastError"])
	}
	if body["ready"] != false {
		t.Fatalf("ready=%v want=false", body["ready"])
	}
	blockers, ok := body["blockers"].([]any)
	if !ok || len(blockers) == 0 {
		t.Fatalf("blockers=%v want non-empty", body["blockers"])
	}
	if strings.TrimSpace(asString(body["recommendedNextCommand"])) == "" {
		t.Fatalf("recommendedNextCommand missing: %v", body)
	}
}
