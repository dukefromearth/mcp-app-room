package config

import (
	"os"
	"path/filepath"
	"strings"
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

func TestResolveConfigPathExplicitWinsOverEnv(t *testing.T) {
	dir := t.TempDir()
	flagPath := filepath.Join(dir, "from-flag.yaml")
	envPath := filepath.Join(dir, "from-env.yaml")
	if err := os.WriteFile(flagPath, []byte("roomd:\n  baseUrl: http://localhost:8190\n"), 0o644); err != nil {
		t.Fatalf("write explicit config: %v", err)
	}
	if err := os.WriteFile(envPath, []byte("roomd:\n  baseUrl: http://localhost:8191\n"), 0o644); err != nil {
		t.Fatalf("write env config: %v", err)
	}

	t.Setenv(ConfigPathEnvVar, envPath)
	resolved, err := ResolveConfigPath(flagPath)
	if err != nil {
		t.Fatalf("resolve config path: %v", err)
	}
	if resolved != flagPath {
		t.Fatalf("resolved=%q want=%q", resolved, flagPath)
	}
}

func TestResolveConfigPathUsesEnvWhenFlagEmpty(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, "from-env.yaml")
	if err := os.WriteFile(envPath, []byte("roomd:\n  baseUrl: http://localhost:8191\n"), 0o644); err != nil {
		t.Fatalf("write env config: %v", err)
	}

	t.Setenv(ConfigPathEnvVar, envPath)
	resolved, err := ResolveConfigPath("")
	if err != nil {
		t.Fatalf("resolve config path: %v", err)
	}
	if resolved != envPath {
		t.Fatalf("resolved=%q want=%q", resolved, envPath)
	}
}

func TestResolveConfigPathAutoDiscoversFromCwdWhenFlagAndEnvEmpty(t *testing.T) {
	dir := t.TempDir()
	configDir := filepath.Join(dir, "config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	configPath := filepath.Join(configDir, "global.yaml")
	if err := os.WriteFile(configPath, []byte("roomd:\n  baseUrl: http://localhost:8190\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir to temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})

	t.Setenv(ConfigPathEnvVar, "")
	resolved, err := ResolveConfigPath("")
	if err != nil {
		t.Fatalf("resolve config path: %v", err)
	}
	resolvedCanonical, err := filepath.EvalSymlinks(resolved)
	if err != nil {
		t.Fatalf("canonicalize resolved path: %v", err)
	}
	expectedCanonical, err := filepath.EvalSymlinks(configPath)
	if err != nil {
		t.Fatalf("canonicalize expected path: %v", err)
	}
	if resolvedCanonical != expectedCanonical {
		t.Fatalf("resolved=%q want=%q", resolvedCanonical, expectedCanonical)
	}
}

func TestResolveConfigPathErrorIsActionable(t *testing.T) {
	dir := t.TempDir()
	previousWD, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir to temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(previousWD)
	})

	t.Setenv(ConfigPathEnvVar, "")
	_, err = ResolveConfigPath("")
	if err == nil {
		t.Fatal("expected resolve config path to fail without flag/env/auto-discovered file")
	}
	if !strings.Contains(err.Error(), "--config") || !strings.Contains(err.Error(), ConfigPathEnvVar) {
		t.Fatalf("expected actionable guidance in error, got: %v", err)
	}
}
