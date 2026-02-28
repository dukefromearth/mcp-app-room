import path from "node:path";
import {
  APPLICABLE_CLIENT_SCENARIOS,
  TIER1_THRESHOLD,
} from "./config";
import {
  assertTierThreshold,
  formatConformanceSummary,
  summarizeConformanceOutput,
} from "./score";

interface CliOptions {
  outputDir: string;
  threshold: number;
  scenarios: string[];
}

async function main(): Promise<void> {
  const options = readCliOptions(process.argv.slice(2));

  const summary = await summarizeConformanceOutput({
    outputDir: options.outputDir,
    threshold: options.threshold,
    expectedScenarios: options.scenarios,
  });

  console.log(formatConformanceSummary(summary));
  console.log(JSON.stringify(summary, null, 2));

  assertTierThreshold(summary);
}

function readCliOptions(argv: string[]): CliOptions {
  const scenarioArgs: string[] = [];
  const projectRoot = path.resolve(process.env.INIT_CWD ?? process.cwd());
  let outputDir = path.join(projectRoot, "artifacts/conformance");
  let threshold = TIER1_THRESHOLD;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--output-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output-dir requires a value");
      }
      outputDir = path.resolve(projectRoot, value);
      index += 1;
      continue;
    }

    if (token === "--threshold") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--threshold requires a value");
      }

      threshold = Number.parseFloat(value);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        throw new Error("--threshold must be a positive number");
      }
      index += 1;
      continue;
    }

    if (token === "--scenario") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--scenario requires a value");
      }
      scenarioArgs.push(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    outputDir,
    threshold,
    scenarios:
      scenarioArgs.length > 0
        ? scenarioArgs
        : [...APPLICABLE_CLIENT_SCENARIOS],
  };
}

main().catch((error) => {
  console.error("[conformance-threshold-check]", error);
  process.exit(1);
});
