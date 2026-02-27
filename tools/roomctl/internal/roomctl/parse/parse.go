package parse

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrInvalidContainer = errors.New("container must be x,y,w,h")

type GridContainer struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

func Container(value string) (GridContainer, error) {
	parts := strings.Split(value, ",")
	if len(parts) != 4 {
		return GridContainer{}, ErrInvalidContainer
	}

	container := GridContainer{}
	_, err := fmt.Sscanf(value, "%d,%d,%d,%d", &container.X, &container.Y, &container.W, &container.H)
	if err != nil {
		return GridContainer{}, ErrInvalidContainer
	}

	if container.X < 0 || container.Y < 0 {
		return GridContainer{}, errors.New("container x,y must be >= 0")
	}

	if container.W < 1 || container.W > 12 {
		return GridContainer{}, errors.New("container w must be between 1 and 12")
	}

	if container.H < 1 {
		return GridContainer{}, errors.New("container h must be >= 1")
	}

	return container, nil
}

func JSONObject(value string) (map[string]any, error) {
	if strings.TrimSpace(value) == "" {
		return map[string]any{}, nil
	}

	var payload any
	if err := json.Unmarshal([]byte(value), &payload); err != nil {
		return nil, fmt.Errorf("parse JSON: %w", err)
	}

	object, ok := payload.(map[string]any)
	if !ok {
		return nil, errors.New("expected JSON object")
	}

	return object, nil
}

func JSONArrayObjects(value string) ([]map[string]any, error) {
	if strings.TrimSpace(value) == "" {
		return nil, errors.New("expected JSON array")
	}

	var payload any
	if err := json.Unmarshal([]byte(value), &payload); err != nil {
		return nil, fmt.Errorf("parse JSON: %w", err)
	}

	items, ok := payload.([]any)
	if !ok {
		return nil, errors.New("expected JSON array")
	}

	objects := make([]map[string]any, 0, len(items))
	for idx, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("expected JSON object at index %d", idx)
		}
		objects = append(objects, object)
	}

	return objects, nil
}

func Order(values []string) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		for _, segment := range strings.Split(value, ",") {
			trimmed := strings.TrimSpace(segment)
			if trimmed == "" {
				continue
			}
			items = append(items, trimmed)
		}
	}
	return items
}
