package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type GlobalConfig struct {
	Roomd struct {
		BaseURL string `yaml:"baseUrl"`
	} `yaml:"roomd"`
}

func ResolveConfigPath(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		if filepath.IsAbs(trimmed) {
			return trimmed, nil
		}
		return filepath.Abs(trimmed)
	}

	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve working directory: %w", err)
	}

	dir := cwd
	for {
		candidate := filepath.Join(dir, "config", "global.yaml")
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate, nil
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	return "", errors.New("could not find config/global.yaml in current or parent directories")
}

func Load(path string) (GlobalConfig, error) {
	configPath, err := ResolveConfigPath(path)
	if err != nil {
		return GlobalConfig{}, err
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		return GlobalConfig{}, fmt.Errorf("read %s: %w", configPath, err)
	}

	var parsed GlobalConfig
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return GlobalConfig{}, fmt.Errorf("parse %s: %w", configPath, err)
	}

	parsed.Roomd.BaseURL = strings.TrimSpace(parsed.Roomd.BaseURL)
	if parsed.Roomd.BaseURL == "" {
		return GlobalConfig{}, fmt.Errorf("roomd.baseUrl missing in %s", configPath)
	}

	return parsed, nil
}
