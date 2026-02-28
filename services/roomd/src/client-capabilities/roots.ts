import type { ClientRoot, ClientRootsConfig } from "../types";

export function defaultRootsConfig(): ClientRootsConfig {
  return {
    enabled: true,
    listChanged: true,
    roots: [],
  };
}

export function mergeRootsConfig(
  current: ClientRootsConfig,
  patch: Partial<ClientRootsConfig> | undefined,
): ClientRootsConfig {
  if (!patch) {
    return cloneRootsConfig(current);
  }

  return {
    enabled: patch.enabled ?? current.enabled,
    listChanged: patch.listChanged ?? current.listChanged,
    roots: patch.roots ? normalizeRoots(patch.roots) : cloneRoots(current.roots),
  };
}

export function normalizeRoots(roots: ClientRoot[]): ClientRoot[] {
  const deduped = new Map<string, ClientRoot>();

  for (const root of roots) {
    const uri = root.uri.trim();
    if (uri.length === 0) {
      continue;
    }

    deduped.set(uri, {
      uri,
      ...(root.name && root.name.trim().length > 0
        ? { name: root.name.trim() }
        : {}),
      ...(root._meta ? { _meta: { ...root._meta } } : {}),
    });
  }

  return [...deduped.values()].sort((left, right) =>
    left.uri.localeCompare(right.uri),
  );
}

export function cloneRootsConfig(config: ClientRootsConfig): ClientRootsConfig {
  return {
    enabled: config.enabled,
    listChanged: config.listChanged,
    roots: cloneRoots(config.roots),
  };
}

function cloneRoots(roots: ClientRoot[]): ClientRoot[] {
  return roots.map((root) => ({
    uri: root.uri,
    ...(root.name ? { name: root.name } : {}),
    ...(root._meta ? { _meta: { ...root._meta } } : {}),
  }));
}
