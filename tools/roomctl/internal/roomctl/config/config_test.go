package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReadsRoomdBaseURL(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configDir := filepath.Join(dir, "config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}

	configPath := filepath.Join(configDir, "global.yaml")
	if err := os.WriteFile(configPath, []byte("roomd:\n  baseUrl: http://localhost:8190\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := Load(configPath)
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.Roomd.BaseURL != "http://localhost:8190" {
		t.Fatalf("roomd.baseUrl=%q want=http://localhost:8190", cfg.Roomd.BaseURL)
	}
}

func TestLoadFailsWhenBaseURLMissing(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "global.yaml")
	if err := os.WriteFile(configPath, []byte("roomd:\n  baseUrl: \"\"\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	if _, err := Load(configPath); err == nil {
		t.Fatal("expected load to fail when roomd.baseUrl missing")
	}
}
