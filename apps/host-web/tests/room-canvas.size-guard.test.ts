import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("room-canvas size guard", () => {
  it("keeps room-canvas.tsx at or below 350 lines", () => {
    const filePath = path.resolve(process.cwd(), "src/room-canvas.tsx");
    const lines = fs.readFileSync(filePath, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(350);
  });
});
