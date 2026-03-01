export function resolveStdioAllowlist(
  configuredAllowlist: string[],
  dangerouslyAllowStdio: boolean,
): string[] {
  if (!dangerouslyAllowStdio || configuredAllowlist.length > 0) {
    return configuredAllowlist;
  }
  return ["*"];
}

export function resolveRemoteHttpOriginAllowlist(
  configuredAllowlist: string[],
  dangerouslyAllowRemoteHttp: boolean,
): string[] {
  if (!dangerouslyAllowRemoteHttp || configuredAllowlist.length > 0) {
    return configuredAllowlist;
  }
  return ["*"];
}
