package cli

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestCallCommandRemovedFromCLI(t *testing.T) {
	t.Parallel()

	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	cmd := newRootCmdWithOptions(&rootOptions{
		baseURL: "http://localhost:8090",
		timeout: 2 * time.Second,
		output:  "json",
		stdout:  stdout,
		stderr:  stderr,
	})
	cmd.SetArgs([]string{"call"})

	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected call command to be unavailable")
	}
	if !strings.Contains(err.Error(), "unknown command") {
		t.Fatalf("unexpected error: %v", err)
	}
}
