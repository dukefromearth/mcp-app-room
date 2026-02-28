import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertTierThreshold,
  summarizeConformanceOutput,
} from "../src/conformance/score";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "conformance");

describe("conformance threshold parser", () => {
  it("passes when fixture output meets Tier 2 threshold", async () => {
    const outputDir = path.join(FIXTURES_DIR, "tier2-pass");

    const summary = await summarizeConformanceOutput({
      outputDir,
      threshold: 0.8,
      expectedScenarios: ["initialize", "tools_call"],
    });

    expect(summary.passRate).toBe(1);
    expect(summary.metThreshold).toBe(true);
    expect(() => assertTierThreshold(summary)).not.toThrow();
  });

  it("fails when fixture output drops below threshold", async () => {
    const outputDir = path.join(FIXTURES_DIR, "tier2-fail");

    const summary = await summarizeConformanceOutput({
      outputDir,
      threshold: 0.8,
      expectedScenarios: ["initialize", "tools_call"],
    });

    expect(summary.passRate).toBe(0.5);
    expect(summary.metThreshold).toBe(false);
    expect(() => assertTierThreshold(summary)).toThrow(
      /Conformance threshold not met/,
    );
  });

  it("fails impossible thresholds with a clear reason", async () => {
    const outputDir = path.join(FIXTURES_DIR, "tier2-pass");

    const summary = await summarizeConformanceOutput({
      outputDir,
      threshold: 1.1,
      expectedScenarios: ["initialize", "tools_call"],
    });

    expect(() => assertTierThreshold(summary)).toThrow(
      /threshold exceeds maximum attainable score/,
    );
  });
});
