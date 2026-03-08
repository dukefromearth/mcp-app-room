import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DEFAULT_MAX_SOURCE_LINES = 450;
const FILE_MAX_OVERRIDES: Record<string, number> = {
  // TODO(#44): remove override after lifecycle-critical seam extraction completes.
  "store.ts": 1300
};

function collectSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    if (entry.name.endsWith(".test.ts")) {
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

describe("roomd domain size guard", () => {
  it(`keeps non-test src TS files at or below ${DEFAULT_MAX_SOURCE_LINES} lines unless issue-linked override exists`, () => {
    const root = path.resolve(process.cwd(), "src");
    const violations = collectSourceFiles(root)
      .map((filePath) => {
        const lineCount = fs.readFileSync(filePath, "utf8").split("\n").length;
        const relativePath = path.relative(root, filePath).replaceAll("\\", "/");
        const fileName = path.basename(relativePath);
        const maxLines = FILE_MAX_OVERRIDES[fileName] ?? DEFAULT_MAX_SOURCE_LINES;
        return { relativePath, lineCount, maxLines };
      })
      .filter(({ lineCount, maxLines }) => lineCount > maxLines)
      .map(({ relativePath, lineCount, maxLines }) => `${relativePath} (${lineCount} > ${maxLines})`);

    expect(violations).toEqual([]);
  });
});
