package cli

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/duke/mcp-app-room/tools/roomctl/internal/roomctl/roomd"
)

func runWithClient(opts *rootOptions, run func(ctx context.Context, client *roomd.Client) (roomd.Envelope, error)) error {
	if opts.timeout <= 0 {
		return errors.New("--timeout must be > 0")
	}

	client, err := roomd.NewClient(opts.baseURL, opts.timeout)
	if err != nil {
		envelope := enrichEnvelopeWithSuggestions(opts.command, envelopeForClientError(err))
		envelope = enrichEnvelopeWithClaims(opts.command, envelope)
		return printEnvelope(opts.stdout, opts.output, envelope)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	envelope, err := run(ctx, client)
	if err != nil {
		failure := enrichEnvelopeWithSuggestions(opts.command, envelopeForClientError(err))
		failure = enrichEnvelopeWithClaims(opts.command, failure)
		return printEnvelope(opts.stdout, opts.output, failure)
	}

	envelope = enrichEnvelopeWithSuggestions(opts.command, envelope)
	envelope = enrichEnvelopeWithClaims(opts.command, envelope)

	return printEnvelope(opts.stdout, opts.output, envelope)
}

func envelopeForClientError(err error) roomd.Envelope {
	message := strings.TrimSpace(err.Error())
	status := 502
	code := "ROOMD_CLIENT_ERROR"
	userMessage := "roomctl request failed"

	switch {
	case strings.Contains(message, "base URL"):
		status = 400
		code = "INVALID_BASE_URL"
		userMessage = "roomctl base URL is invalid"
	case strings.Contains(message, "connection refused"):
		status = 503
		code = "ROOMD_UNREACHABLE"
		userMessage = "roomd is not reachable at the configured base URL"
	case strings.Contains(message, "i/o timeout"), strings.Contains(message, "context deadline exceeded"):
		status = 504
		code = "ROOMD_TIMEOUT"
		userMessage = "roomd request timed out"
	}

	return roomd.Envelope{
		Status: status,
		Body: map[string]any{
			"ok":      false,
			"code":    code,
			"error":   userMessage,
			"details": map[string]any{"cause": message},
		},
	}
}
