package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAwaitCommandIntegrationMatchesEvidence(t *testing.T) {
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
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":5,"evidence":[]}}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":7,"evidence":[{"event":"app_initialized","instanceId":"inst-1","revision":7}]}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--instance", "inst-1",
		"--event", "app_initialized",
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
	if body["event"] != "app_initialized" {
		t.Fatalf("event=%v want=app_initialized", body["event"])
	}
	if revision, ok := body["revision"].(float64); !ok || int(revision) != 7 {
		t.Fatalf("revision=%v want=7 (matched evidence revision)", body["revision"])
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
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":2,"evidence":[]}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--event", "app_initialized",
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
	if body["code"] != "EVIDENCE_TIMEOUT" {
		t.Fatalf("code=%v want=EVIDENCE_TIMEOUT", body["code"])
	}
}

func TestAwaitCommandIntegrationReturnsMatchedEvidenceRevisionWhenStateAdvances(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/state" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"ok":false}`))
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":12,"evidence":[{"event":"resource_delivered","instanceId":"inst-1","revision":11}]}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"await",
		"--room", "demo",
		"--instance", "inst-1",
		"--event", "resource_delivered",
		"--since-revision", "10",
		"--poll-interval", "5ms",
		"--max-wait", "100ms",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if revision, ok := body["revision"].(float64); !ok || int(revision) != 11 {
		t.Fatalf("revision=%v want=11 (matched evidence revision)", body["revision"])
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
		_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":3,"mounts":[],"order":[],"selectedInstanceId":null,"invocations":[],"evidence":[],"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":["Control-plane mount exists and is addressable."],"unknown":["User-visible render completeness is unknown."]}]}}}`))
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

func TestToolCallRequireEvidenceSuccess(t *testing.T) {
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
				_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"evidence":[]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":11,"evidence":[{"event":"app_initialized","instanceId":"inst-1","revision":11}]}}`))
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
		"--require-evidence", "app_initialized",
		"--evidence-poll-interval", "5ms",
		"--evidence-max-wait", "200ms",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if _, ok := body["evidenceMatches"].(map[string]any); !ok {
		t.Fatalf("expected evidenceMatches in body, got=%v", body)
	}
}

func TestToolCallRequireEvidenceMissing(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rooms/demo/instances/inst-1/tools/call":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"content":[{"type":"text","text":"done"}]}`))
		case "/rooms/demo/state":
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"evidence":[]}}`))
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
		"--require-evidence", "app_initialized",
		"--evidence-poll-interval", "5ms",
		"--evidence-max-wait", "30ms",
	)

	if env.Status != http.StatusPreconditionFailed {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusPreconditionFailed)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["code"] != "REQUIRED_EVIDENCE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_EVIDENCE_MISSING", body["code"])
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
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":[],"unknown":["User-visible render completeness is unknown."]}]},"evidence":[]}}`))
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
		"--evidence-poll-interval", "5ms",
		"--evidence-max-wait", "30ms",
	)

	if env.Status != http.StatusPreconditionFailed {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusPreconditionFailed)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["code"] != "REQUIRED_EVIDENCE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_EVIDENCE_MISSING", body["code"])
	}
	if stateCalls < 2 {
		t.Fatalf("stateCalls=%d want>=2 for baseline + polling", stateCalls)
	}
}

func TestToolCallNoAwaitBypassesDefaultAwait(t *testing.T) {
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
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":[],"unknown":["User-visible render completeness is unknown."]}]},"evidence":[]}}`))
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
		"--no-await",
		"--evidence-poll-interval", "5ms",
		"--evidence-max-wait", "30ms",
	)

	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
	if stateCalls != 0 {
		t.Fatalf("stateCalls=%d want=0 when --no-await disables default gating", stateCalls)
	}
}

func TestToolCallDefaultAwaitIgnoresOtherInstanceEvidence(t *testing.T) {
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
				_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":10,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":[],"unknown":["User-visible render completeness is unknown."]}]},"evidence":[]}}`))
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"state":{"revision":11,"mounts":[{"instanceId":"inst-1","uiResourceUri":"ui://demo/app.html"}],"assurance":{"generatedAt":"2026-03-01T00:00:00Z","instances":[{"instanceId":"inst-1","level":"control_plane_ok","proven":[],"unknown":["User-visible render completeness is unknown."]}]},"evidence":[{"event":"app_initialized","instanceId":"inst-2","revision":11}]}}`))
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
		"--evidence-poll-interval", "5ms",
		"--evidence-max-wait", "30ms",
	)

	if env.Status != http.StatusPreconditionFailed {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusPreconditionFailed)
	}
	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("unexpected body type: %T", env.Body)
	}
	if body["code"] != "REQUIRED_EVIDENCE_MISSING" {
		t.Fatalf("code=%v want=REQUIRED_EVIDENCE_MISSING", body["code"])
	}
}
