function parseHttpUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizePathname(value: string): string {
  return value.length > 0 ? value : "/";
}

function normalizePrefixPathname(value: string): string {
  const normalized = normalizePathname(value);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

export function matchesHttpUrlPrefix(
  targetUrl: string,
  configuredPrefix: string,
): boolean {
  const target = parseHttpUrl(targetUrl);
  const prefix = parseHttpUrl(configuredPrefix);

  if (!target || !prefix) {
    return false;
  }

  if (target.origin !== prefix.origin) {
    return false;
  }

  const targetPath = normalizePathname(target.pathname);
  const prefixPath = normalizePathname(prefix.pathname);

  if (prefixPath === "/") {
    return true;
  }

  const prefixPathWithBoundary = normalizePrefixPathname(prefix.pathname);
  const exactPrefixPath = prefixPathWithBoundary.slice(0, -1);
  return (
    targetPath === exactPrefixPath ||
    targetPath.startsWith(prefixPathWithBoundary)
  );
}
