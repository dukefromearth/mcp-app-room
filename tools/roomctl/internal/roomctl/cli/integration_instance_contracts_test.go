package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCapabilitiesCommandContract(t *testing.T) {
	t.Parallel()

	var gotMethod, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"capabilities":{"tools":{}}}`))
	}))
	defer server.Close()

	env := runCommand(t, server.URL, "capabilities", "--room", "demo", "--instance", "inst-1")
	if gotMethod != http.MethodGet {
		t.Fatalf("method=%s want=%s", gotMethod, http.MethodGet)
	}
	if gotPath != "/rooms/demo/instances/inst-1/capabilities" {
		t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/capabilities", gotPath)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestInstanceListCommandContracts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		args     []string
		wantPath string
	}{
		{
			name:     "resources-list",
			args:     []string{"resources-list", "--room", "demo", "--instance", "inst-1", "--cursor", "next"},
			wantPath: "/rooms/demo/instances/inst-1/resources/list",
		},
		{
			name:     "resource-templates-list",
			args:     []string{"resource-templates-list", "--room", "demo", "--instance", "inst-1", "--cursor", "next"},
			wantPath: "/rooms/demo/instances/inst-1/resources/templates/list",
		},
		{
			name:     "prompts-list",
			args:     []string{"prompts-list", "--room", "demo", "--instance", "inst-1", "--cursor", "next"},
			wantPath: "/rooms/demo/instances/inst-1/prompts/list",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var gotMethod, gotPath string
			var gotBody struct {
				Cursor string `json:"cursor"`
			}
			var decodeErr error
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				gotPath = r.URL.Path
				decodeErr = json.NewDecoder(r.Body).Decode(&gotBody)
				w.Header().Set("content-type", "application/json")
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer server.Close()

			env := runCommand(t, server.URL, tc.args...)
			if gotMethod != http.MethodPost {
				t.Fatalf("method=%s want=%s", gotMethod, http.MethodPost)
			}
			if gotPath != tc.wantPath {
				t.Fatalf("path=%s want=%s", gotPath, tc.wantPath)
			}
			if decodeErr != nil {
				t.Fatalf("decode request body: %v", decodeErr)
			}
			if gotBody.Cursor != "next" {
				t.Fatalf("cursor=%q want=next", gotBody.Cursor)
			}
			if env.Status != http.StatusOK {
				t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
			}
		})
	}
}

func TestResourcesReadErrorEnvelopeContract(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rooms/demo/instances/inst-1/resources/read" {
			t.Fatalf("path=%s want=/rooms/demo/instances/inst-1/resources/read", r.URL.Path)
		}
		w.Header().Set("content-type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"ok":false,"error":"Server does not support resources/read","code":"UNSUPPORTED_CAPABILITY","hint":"Check capabilities first.","details":{"operation":"resources/read"}}`))
	}))
	defer server.Close()

	env := runCommand(
		t,
		server.URL,
		"resources-read",
		"--room", "demo",
		"--instance", "inst-1",
		"--uri", "file://notes.md",
	)
	if env.Status != http.StatusBadRequest {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusBadRequest)
	}

	body, ok := env.Body.(map[string]any)
	if !ok {
		t.Fatalf("body type=%T want map", env.Body)
	}
	if body["code"] != "UNSUPPORTED_CAPABILITY" {
		t.Fatalf("code=%v want=UNSUPPORTED_CAPABILITY", body["code"])
	}
	if body["error"] != "Server does not support resources/read" {
		t.Fatalf("error=%v", body["error"])
	}
	if body["hint"] != "Check capabilities first." {
		t.Fatalf("hint=%v", body["hint"])
	}
	details, ok := body["details"].(map[string]any)
	if !ok || details["operation"] != "resources/read" {
		t.Fatalf("details=%v", body["details"])
	}
}
