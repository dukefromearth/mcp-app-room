import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHostAssetPaths } from "../asset-paths";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function writeHostAssets(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.html"), "<html>index</html>");
  await writeFile(join(directory, "sandbox.html"), "<html>sandbox</html>");
}

describe("resolveHostAssetPaths", () => {
  it("prefers moduleDir/dist when both host assets exist", async () => {
    const moduleDir = await makeTempDir("host-assets-module-");
    const moduleDist = join(moduleDir, "dist");
    await writeHostAssets(moduleDist);

    const resolved = resolveHostAssetPaths({ moduleDir, cwd: "/" });

    expect(resolved.distDir).toBe(moduleDist);
    expect(resolved.indexHtmlPath).toBe(join(moduleDist, "index.html"));
    expect(resolved.sandboxHtmlPath).toBe(join(moduleDist, "sandbox.html"));
  });

  it("falls back to cwd/apps/host-web/dist when module candidates are missing", async () => {
    const moduleDir = await makeTempDir("host-assets-empty-module-");
    const cwd = await makeTempDir("host-assets-repo-root-");
    const repoDist = join(cwd, "apps", "host-web", "dist");
    await writeHostAssets(repoDist);

    const resolved = resolveHostAssetPaths({ moduleDir, cwd });

    expect(resolved.distDir).toBe(repoDist);
  });

  it("supports runtime where moduleDir is already dist", async () => {
    const runtimeDir = await makeTempDir("host-assets-runtime-");
    const moduleDist = join(runtimeDir, "dist");
    await writeHostAssets(moduleDist);

    const resolved = resolveHostAssetPaths({ moduleDir: moduleDist, cwd: "/" });

    expect(resolved.distDir).toBe(moduleDist);
  });

  it("throws an actionable error when no candidate has both files", async () => {
    const moduleDir = await makeTempDir("host-assets-missing-");

    expect(() => resolveHostAssetPaths({ moduleDir, cwd: "/" })).toThrow(
      "Run `npm run --workspace apps/host-web build` before starting the host.",
    );
  });
});
