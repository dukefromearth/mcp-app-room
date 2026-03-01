package roomd

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

type Envelope struct {
	Status int `json:"status"`
	Body   any `json:"body"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string, timeout time.Duration) (*Client, error) {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return nil, fmt.Errorf("base URL cannot be empty")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("parse base URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("base URL must include scheme and host")
	}

	return &Client{
		baseURL: strings.TrimRight(parsed.String(), "/"),
		http: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

func (c *Client) Health(ctx context.Context) (Envelope, error) {
	return c.do(ctx, http.MethodGet, "/health", nil)
}

func (c *Client) CreateRoom(ctx context.Context, roomID string) (Envelope, error) {
	payload := map[string]any{"roomId": roomID}
	return c.do(ctx, http.MethodPost, "/rooms", payload)
}

func (c *Client) State(ctx context.Context, roomID string) (Envelope, error) {
	return c.do(ctx, http.MethodGet, "/rooms/"+url.PathEscape(roomID)+"/state", nil)
}

func (c *Client) Command(ctx context.Context, roomID string, idempotencyKey string, command map[string]any) (Envelope, error) {
	payload := map[string]any{
		"idempotencyKey": idempotencyKey,
		"command":        command,
	}
	return c.do(ctx, http.MethodPost, "/rooms/"+url.PathEscape(roomID)+"/commands", payload)
}

func (c *Client) InspectServer(ctx context.Context, server string) (Envelope, error) {
	payload := map[string]any{
		"server": server,
	}
	return c.do(ctx, http.MethodPost, "/inspect/server", payload)
}

func (c *Client) InstanceCapabilities(ctx context.Context, roomID string, instanceID string) (Envelope, error) {
	return c.instanceGet(ctx, roomID, instanceID, "capabilities")
}

func (c *Client) InstanceToolsList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "tools/list", withOptionalCursor(cursor))
}

func (c *Client) InstanceToolCall(
	ctx context.Context,
	roomID string,
	instanceID string,
	name string,
	arguments map[string]any,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	})
}

func (c *Client) InstanceResourcesList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "resources/list", withOptionalCursor(cursor))
}

func (c *Client) InstanceResourceRead(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "resources/read", map[string]any{"uri": uri})
}

func (c *Client) InstanceResourceTemplatesList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "resources/templates/list", withOptionalCursor(cursor))
}

func (c *Client) InstancePromptsList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "prompts/list", withOptionalCursor(cursor))
}

func (c *Client) InstancePromptGet(
	ctx context.Context,
	roomID string,
	instanceID string,
	name string,
	arguments map[string]string,
) (Envelope, error) {
	payload := map[string]any{"name": name}
	if len(arguments) > 0 {
		payload["arguments"] = arguments
	}
	return c.instancePost(ctx, roomID, instanceID, "prompts/get", payload)
}

func (c *Client) InstanceComplete(
	ctx context.Context,
	roomID string,
	instanceID string,
	params map[string]any,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "completion/complete", params)
}

func (c *Client) InstanceResourceSubscribe(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "resources/subscribe", map[string]any{"uri": uri})
}

func (c *Client) InstanceResourceUnsubscribe(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	return c.instancePost(ctx, roomID, instanceID, "resources/unsubscribe", map[string]any{"uri": uri})
}

func withOptionalCursor(cursor string) map[string]any {
	payload := map[string]any{}
	if strings.TrimSpace(cursor) != "" {
		payload["cursor"] = cursor
	}
	return payload
}

func (c *Client) instanceGet(ctx context.Context, roomID string, instanceID string, suffix string) (Envelope, error) {
	return c.do(ctx, http.MethodGet, c.instanceEndpoint(roomID, instanceID, suffix), nil)
}

func (c *Client) instancePost(ctx context.Context, roomID string, instanceID string, suffix string, payload any) (Envelope, error) {
	return c.do(ctx, http.MethodPost, c.instanceEndpoint(roomID, instanceID, suffix), payload)
}

func (c *Client) instanceEndpoint(roomID string, instanceID string, suffix string) string {
	return fmt.Sprintf(
		"/rooms/%s/instances/%s/%s",
		url.PathEscape(roomID),
		url.PathEscape(instanceID),
		strings.TrimPrefix(suffix, "/"),
	)
}

func (c *Client) do(ctx context.Context, method string, endpoint string, payload any) (Envelope, error) {
	requestURL, err := c.joinPath(endpoint)
	if err != nil {
		return Envelope{}, err
	}

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return Envelope{}, fmt.Errorf("marshal payload: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return Envelope{}, fmt.Errorf("build request: %w", err)
	}

	if payload != nil {
		req.Header.Set("content-type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return Envelope{}, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	parsedBody, err := decodeBody(resp.Body)
	if err != nil {
		return Envelope{}, err
	}

	return Envelope{Status: resp.StatusCode, Body: parsedBody}, nil
}

func decodeBody(input io.Reader) (any, error) {
	content, err := io.ReadAll(input)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	if len(content) == 0 {
		return map[string]any{}, nil
	}

	var parsed any
	if err := json.Unmarshal(content, &parsed); err != nil {
		return map[string]any{"raw": string(content)}, nil
	}

	return parsed, nil
}

func (c *Client) joinPath(endpoint string) (string, error) {
	parsed, err := url.Parse(c.baseURL)
	if err != nil {
		return "", fmt.Errorf("parse base URL: %w", err)
	}

	parsed.Path = path.Join(parsed.Path, endpoint)
	return parsed.String(), nil
}
