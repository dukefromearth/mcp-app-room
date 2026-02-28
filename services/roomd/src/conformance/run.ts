import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import {
  APPLICABLE_CLIENT_SCENARIOS,
  CONFORMANCE_PACKAGE_VERSION,
  CONFORMANCE_SPEC_VERSION,
  TIER2_THRESHOLD,
} from "./config";
import {
  assertTierThreshold,
  formatConformanceSummary,
  summarizeConformanceOutput,
} from "./score";

interface CliOptions {
  outputDir: string;
  threshold: number;
  specVersion: string;
  scenarios: string[];
}

async function main(): Promise<void> {
  const options = readCliOptions(process.argv.slice(2));

  await fs.rm(options.outputDir, { recursive: true, force: true });
  await fs.mkdir(options.outputDir, { recursive: true });

  const failedScenarioRuns: string[] = [];
  for (const scenario of options.scenarios) {
    console.log(`[conformance] running scenario: ${scenario}`);

    const exitCode = await runCommand("npx", [
      "-y",
      `@modelcontextprotocol/conformance@${CONFORMANCE_PACKAGE_VERSION}`,
      "client",
      "--command",
      "npm run conformance:client:run --",
      "--scenario",
      scenario,
      "--spec-version",
      options.specVersion,
      "-o",
      options.outputDir,
    ]);

    if (exitCode !== 0) {
      failedScenarioRuns.push(scenario);
    }
  }

  const summary = await summarizeConformanceOutput({
    outputDir: options.outputDir,
    threshold: options.threshold,
    expectedScenarios: options.scenarios,
  });

  console.log(formatConformanceSummary(summary));
  console.log(JSON.stringify(summary, null, 2));

  if (failedScenarioRuns.length > 0) {
    console.error(
      `[conformance] scenario command failures: ${failedScenarioRuns.join(", ")}`,
    );
  }

  assertTierThreshold(summary);
}

function readCliOptions(argv: string[]): CliOptions {
  const scenarioArgs: string[] = [];
  const projectRoot = path.resolve(process.env.INIT_CWD ?? process.cwd());
  let outputDir = path.join(projectRoot, "artifacts/conformance");
  let threshold = TIER2_THRESHOLD;
  let specVersion = CONFORMANCE_SPEC_VERSION;

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

    if (token === "--spec-version") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--spec-version requires a value");
      }
      specVersion = value;
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
    specVersion,
    scenarios:
      scenarioArgs.length > 0
        ? scenarioArgs
        : [...APPLICABLE_CLIENT_SCENARIOS],
  };
}

async function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

main().catch((error) => {
  console.error("[conformance-runner]", error);
  process.exit(1);
});
