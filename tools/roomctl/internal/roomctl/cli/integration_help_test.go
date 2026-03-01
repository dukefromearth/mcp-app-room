package cli

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestRootHelpIncludesOrientation(t *testing.T) {
	t.Parallel()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: "http://example.test:8090",
		timeout: 15 * time.Second,
		output:  "pretty",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"--help"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute help failed: %v; stderr=%s", err, strings.TrimSpace(stderr.String()))
	}

	rendered := stdout.String()
	if !strings.Contains(rendered, "WHERE YOU ARE") {
		t.Fatalf("missing WHERE YOU ARE section: %s", rendered)
	}
	if !strings.Contains(rendered, "WHY YOU'RE HERE") {
		t.Fatalf("missing WHY YOU'RE HERE section: %s", rendered)
	}
	if !strings.Contains(rendered, "http://example.test:8090") {
		t.Fatalf("missing configured base URL: %s", rendered)
	}
	if !strings.Contains(rendered, "Available Commands:") && !strings.Contains(rendered, "Usage:") {
		t.Fatalf("missing standard cobra help output: %s", rendered)
	}
}
