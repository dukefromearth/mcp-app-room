import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MAX_SOURCE_LINES = 1300;

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
  it(`keeps non-test src TS files at or below ${MAX_SOURCE_LINES} lines`, () => {
    const root = path.resolve(process.cwd(), "src");
    const violations = collectSourceFiles(root)
      .map((filePath) => {
        const lineCount = fs.readFileSync(filePath, "utf8").split("\n").length;
        return { filePath, lineCount };
      })
      .filter(({ lineCount }) => lineCount > MAX_SOURCE_LINES)
      .map(({ filePath, lineCount }) => `${path.relative(process.cwd(), filePath)} (${lineCount})`);

    expect(violations).toEqual([]);
  });
});
