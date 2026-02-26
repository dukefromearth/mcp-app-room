package main

import (
	"fmt"
	"os"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/cli"
)

func main() {
	cmd := cli.NewRootCmd()
	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
