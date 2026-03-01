import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("RoomStore size guard", () => {
  it("keeps store.ts at or below 1300 lines", () => {
    const storePath = path.resolve(process.cwd(), "src/store.ts");
    const content = fs.readFileSync(storePath, "utf8");
    const lineCount = content.split("\n").length;

    expect(lineCount).toBeLessThanOrEqual(1300);
  });
});
