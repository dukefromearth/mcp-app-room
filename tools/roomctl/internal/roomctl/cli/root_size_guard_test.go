package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const defaultMaxLines = 450

var fileMaxOverrides = map[string]int{
	// TODO(#45): remove override after roomctl root seam extraction completes.
	"root.go": 1100,
}

func TestRootGoSizeGuard(t *testing.T) {
	t.Parallel()

	rootPath := filepath.Join("root.go")
	content, err := os.ReadFile(rootPath)
	if err != nil {
		t.Fatalf("read %s: %v", rootPath, err)
	}

	lineCount := strings.Count(string(content), "\n")
	maxLines := defaultMaxLines
	if override, ok := fileMaxOverrides[rootPath]; ok {
		maxLines = override
	}
	if lineCount > maxLines {
		t.Fatalf("root.go line count %d exceeds guard %d", lineCount, maxLines)
	}
}
