import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";

export interface HostAssetPaths {
  distDir: string;
  indexHtmlPath: string;
  sandboxHtmlPath: string;
}

interface ResolveHostAssetPathsOptions {
  moduleDir: string;
  cwd?: string;
  exists?: (path: string) => boolean;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function hasHostAssets(directory: string, exists: (path: string) => boolean): boolean {
  return exists(join(directory, "index.html")) && exists(join(directory, "sandbox.html"));
}

export function resolveHostAssetPaths(
  options: ResolveHostAssetPathsOptions,
): HostAssetPaths {
  const cwd = options.cwd ?? process.cwd();
  const pathExists = options.exists ?? existsSync;
  const moduleDir = options.moduleDir;

  const candidateDirs = uniquePaths([
    join(moduleDir, "dist"),
    basename(moduleDir) === "dist" ? moduleDir : "",
    resolve(moduleDir, "..", "dist"),
    join(cwd, "dist"),
    join(cwd, "apps", "host-web", "dist"),
  ].filter((value) => value.length > 0));

  for (const candidate of candidateDirs) {
    if (!hasHostAssets(candidate, pathExists)) {
      continue;
    }
    return {
      distDir: candidate,
      indexHtmlPath: join(candidate, "index.html"),
      sandboxHtmlPath: join(candidate, "sandbox.html"),
    };
  }

  throw new Error(
    [
      "Host web assets not found. Expected built index/sandbox HTML in one of:",
      ...candidateDirs.map((path) => `- ${path}`),
      "Run `npm run --workspace apps/host-web build` before starting the host.",
    ].join("\n"),
  );
}
