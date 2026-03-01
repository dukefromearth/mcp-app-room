package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRootGoSizeGuard(t *testing.T) {
	t.Parallel()

	rootPath := filepath.Join("root.go")
	content, err := os.ReadFile(rootPath)
	if err != nil {
		t.Fatalf("read %s: %v", rootPath, err)
	}

	lineCount := strings.Count(string(content), "\n")
	if lineCount > 1100 {
		t.Fatalf("root.go line count %d exceeds guard 1100", lineCount)
	}
}
