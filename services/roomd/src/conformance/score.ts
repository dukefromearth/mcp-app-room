import path from "node:path";
import { promises as fs } from "node:fs";
import {
  APPLICABLE_CLIENT_SCENARIOS,
  TIER1_THRESHOLD,
  type ApplicableClientScenario,
} from "./config";

const TIMESTAMP_SUFFIX = /-\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

type CheckStatus = "SUCCESS" | "FAILURE" | "WARNING" | "INFO" | string;

export interface ScenarioScore {
  scenario: string;
  checksPath?: string;
  successCount: number;
  failureCount: number;
  warningCount: number;
  passed: boolean;
  reason?: string;
}

export interface ConformanceSummary {
  threshold: number;
  passedCount: number;
  failedCount: number;
  totalScenarios: number;
  passRate: number;
  metThreshold: boolean;
  scenarios: ScenarioScore[];
}

export interface SummarizeOptions {
  outputDir: string;
  threshold?: number;
  expectedScenarios?: readonly string[];
}

export async function summarizeConformanceOutput(
  options: SummarizeOptions,
): Promise<ConformanceSummary> {
  const expectedScenarios =
    options.expectedScenarios ?? APPLICABLE_CLIENT_SCENARIOS;
  const threshold = options.threshold ?? TIER1_THRESHOLD;

  const checksByScenario = await loadScenarioChecks(options.outputDir);
  const scenarios: ScenarioScore[] = [];

  for (const scenario of expectedScenarios) {
    const checksPath = checksByScenario.get(scenario);

    if (!checksPath) {
      scenarios.push({
        scenario,
        successCount: 0,
        failureCount: 1,
        warningCount: 0,
        passed: false,
        reason: "checks.json not found for expected scenario",
      });
      continue;
    }

    const parsed = await parseChecksFile(checksPath);
    scenarios.push({
      scenario,
      checksPath,
      successCount: parsed.successCount,
      failureCount: parsed.failureCount,
      warningCount: parsed.warningCount,
      passed: parsed.passed,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
    });
  }

  const passedCount = scenarios.filter((scenario) => scenario.passed).length;
  const totalScenarios = scenarios.length;
  const failedCount = totalScenarios - passedCount;
  const passRate = totalScenarios === 0 ? 0 : passedCount / totalScenarios;

  return {
    threshold,
    passedCount,
    failedCount,
    totalScenarios,
    passRate,
    metThreshold: passRate >= threshold,
    scenarios,
  };
}

export function assertTierThreshold(summary: ConformanceSummary): void {
  if (summary.metThreshold) {
    return;
  }

  const failedScenarios = summary.scenarios
    .filter((scenario) => !scenario.passed)
    .map((scenario) =>
      scenario.reason
        ? `${scenario.scenario} (${scenario.reason})`
        : `${scenario.scenario} (failures=${scenario.failureCount}, warnings=${scenario.warningCount})`,
    );

  const failureDetails =
    failedScenarios.length > 0
      ? failedScenarios.join("; ")
      : "no failed scenarios (threshold exceeds maximum attainable score)";

  throw new Error(
    `Conformance threshold not met: ${(summary.passRate * 100).toFixed(2)}% < ${(summary.threshold * 100).toFixed(2)}% :: ${failureDetails}`,
  );
}

export function formatConformanceSummary(summary: ConformanceSummary): string {
  const lines = [
    `Conformance pass rate: ${(summary.passRate * 100).toFixed(2)}% (${summary.passedCount}/${summary.totalScenarios})`,
    `Conformance threshold: ${(summary.threshold * 100).toFixed(2)}%`,
  ];

  for (const scenario of summary.scenarios) {
    lines.push(
      ` - ${scenario.scenario}: ${scenario.passed ? "PASS" : "FAIL"} (success=${scenario.successCount}, failure=${scenario.failureCount}, warning=${scenario.warningCount})${scenario.reason ? ` [${scenario.reason}]` : ""}`,
    );
  }

  return lines.join("\n");
}

async function loadScenarioChecks(outputDir: string): Promise<Map<string, string>> {
  const checksFiles = await findChecksFiles(outputDir);
  const byScenario = new Map<string, string>();

  for (const filePath of checksFiles) {
    const scenario = scenarioFromChecksPath(outputDir, filePath);

    if (!scenario) {
      continue;
    }

    const current = byScenario.get(scenario);
    if (!current) {
      byScenario.set(scenario, filePath);
      continue;
    }

    const currentMtime = await fileMtimeMs(current);
    const nextMtime = await fileMtimeMs(filePath);
    if (nextMtime > currentMtime) {
      byScenario.set(scenario, filePath);
    }
  }

  return byScenario;
}

function scenarioFromChecksPath(outputDir: string, checksPath: string): string | null {
  const relativeParent = path
    .relative(outputDir, path.dirname(checksPath))
    .split(path.sep)
    .join("/");

  if (!relativeParent) {
    return null;
  }

  return relativeParent.replace(TIMESTAMP_SUFFIX, "");
}

async function parseChecksFile(checksPath: string): Promise<{
  successCount: number;
  failureCount: number;
  warningCount: number;
  passed: boolean;
  reason?: string;
}> {
  try {
    const raw = await fs.readFile(checksPath, "utf8");
    const parsed = JSON.parse(raw) as Array<{ status?: CheckStatus }>;

    if (!Array.isArray(parsed)) {
      return {
        successCount: 0,
        failureCount: 1,
        warningCount: 0,
        passed: false,
        reason: "checks.json must be an array",
      };
    }

    const successCount = parsed.filter((check) => check.status === "SUCCESS").length;
    const failureCount = parsed.filter((check) => check.status === "FAILURE").length;
    const warningCount = parsed.filter((check) => check.status === "WARNING").length;

    return {
      successCount,
      failureCount,
      warningCount,
      passed: failureCount === 0 && warningCount === 0 && successCount > 0,
      ...(successCount === 0
        ? { reason: "no SUCCESS checks recorded" }
        : {}),
    };
  } catch (error) {
    return {
      successCount: 0,
      failureCount: 1,
      warningCount: 0,
      passed: false,
      reason: `unable to parse checks.json (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

async function findChecksFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  if (!(await pathExists(rootDir))) {
    return files;
  }

  await walk(rootDir, files);
  return files;
}

async function walk(currentDir: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walk(entryPath, files);
      continue;
    }

    if (entry.isFile() && entry.name === "checks.json") {
      files.push(entryPath);
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileMtimeMs(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.mtimeMs;
}

export function defaultScenarioList(): readonly ApplicableClientScenario[] {
  return APPLICABLE_CLIENT_SCENARIOS;
}
