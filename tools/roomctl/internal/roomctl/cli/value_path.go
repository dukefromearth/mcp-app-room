package cli

import (
	"fmt"
	"strconv"
	"strings"
)

func mapStringAnyToString(values map[string]any) (map[string]string, error) {
	result := make(map[string]string, len(values))
	for key, value := range values {
		asString, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("expected string value for key %q", key)
		}
		result[key] = asString
	}
	return result, nil
}

func lookupByPath(root any, valuePath string) (any, bool) {
	current := root
	segments := strings.Split(valuePath, ".")
	for _, segment := range segments {
		if strings.TrimSpace(segment) == "" {
			return nil, false
		}

		switch typed := current.(type) {
		case map[string]any:
			next, ok := typed[segment]
			if !ok {
				return nil, false
			}
			current = next
		case []any:
			index, err := strconv.Atoi(segment)
			if err != nil || index < 0 || index >= len(typed) {
				return nil, false
			}
			current = typed[index]
		default:
			return nil, false
		}
	}

	return current, true
}
