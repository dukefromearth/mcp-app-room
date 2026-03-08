package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	roomctlconfig "github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/config"
	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func TestConfigResolutionUsesEnvWhenFlagEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	configPath := writeGlobalConfigForTest(t, server.URL)
	t.Setenv(roomctlconfig.ConfigPathEnvVar, configPath)

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		timeout: 2 * time.Second,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"health"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v", err)
	}

	var env roomd.Envelope
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &env); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func TestConfigResolutionExplicitFlagWinsOverEnv(t *testing.T) {
	goodServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer goodServer.Close()

	flagConfigPath := writeGlobalConfigForTest(t, goodServer.URL)
	envConfigPath := writeGlobalConfigForTest(t, "http://127.0.0.1:1")
	t.Setenv(roomctlconfig.ConfigPathEnvVar, envConfigPath)

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		timeout: 2 * time.Second,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"--config", flagConfigPath, "health"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute command failed: %v", err)
	}

	var env roomd.Envelope
	if err := json.Unmarshal(bytes.TrimSpace(stdout.Bytes()), &env); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if env.Status != http.StatusOK {
		t.Fatalf("status=%d want=%d", env.Status, http.StatusOK)
	}
}

func writeGlobalConfigForTest(t *testing.T, baseURL string) string {
	t.Helper()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "global.yaml")
	content := []byte("roomd:\n  baseUrl: \"" + baseURL + "\"\n")
	if err := os.WriteFile(configPath, content, 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return configPath
}
