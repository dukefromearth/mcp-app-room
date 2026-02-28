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
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/capabilities"
	return c.do(ctx, http.MethodGet, endpoint, nil)
}

func (c *Client) InstanceToolsList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/tools/list"
	payload := map[string]any{}
	if strings.TrimSpace(cursor) != "" {
		payload["cursor"] = cursor
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceToolCall(
	ctx context.Context,
	roomID string,
	instanceID string,
	name string,
	arguments map[string]any,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/tools/call"
	payload := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceResourcesList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/resources/list"
	payload := map[string]any{}
	if strings.TrimSpace(cursor) != "" {
		payload["cursor"] = cursor
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceResourceRead(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/resources/read"
	payload := map[string]any{"uri": uri}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceResourceTemplatesList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/resources/templates/list"
	payload := map[string]any{}
	if strings.TrimSpace(cursor) != "" {
		payload["cursor"] = cursor
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstancePromptsList(
	ctx context.Context,
	roomID string,
	instanceID string,
	cursor string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/prompts/list"
	payload := map[string]any{}
	if strings.TrimSpace(cursor) != "" {
		payload["cursor"] = cursor
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstancePromptGet(
	ctx context.Context,
	roomID string,
	instanceID string,
	name string,
	arguments map[string]string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/prompts/get"
	payload := map[string]any{"name": name}
	if len(arguments) > 0 {
		payload["arguments"] = arguments
	}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceComplete(
	ctx context.Context,
	roomID string,
	instanceID string,
	params map[string]any,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/completion/complete"
	return c.do(ctx, http.MethodPost, endpoint, params)
}

func (c *Client) InstanceResourceSubscribe(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/resources/subscribe"
	payload := map[string]any{"uri": uri}
	return c.do(ctx, http.MethodPost, endpoint, payload)
}

func (c *Client) InstanceResourceUnsubscribe(
	ctx context.Context,
	roomID string,
	instanceID string,
	uri string,
) (Envelope, error) {
	endpoint := "/rooms/" + url.PathEscape(roomID) + "/instances/" + url.PathEscape(instanceID) + "/resources/unsubscribe"
	payload := map[string]any{"uri": uri}
	return c.do(ctx, http.MethodPost, endpoint, payload)
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
