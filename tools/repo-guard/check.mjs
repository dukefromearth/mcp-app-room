#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import fg from "fast-glob";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const writeBaseline = args.has("--write-baseline");
const debug = args.has("--debug");

function git(argsList) {
  return execFileSync("git", argsList, { encoding: "utf8" }).trim();
}

function gitLsFilesAll() {
  const raw = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return raw.split("\0").filter(Boolean);
}

function gitLsFilesByGlob(globPattern) {
  const raw = execFileSync("git", ["ls-files", "-z", "--", `:(glob)${globPattern}`], {
    encoding: "utf8"
  });
  return raw.split("\0").filter(Boolean);
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function countLines(content) {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

function hasIgnoredSegment(relPath, ignoredNames) {
  const segments = relPath.split("/");
  return segments.some((segment) => ignoredNames.has(segment));
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
process.chdir(repoRoot);

const configPath = path.join(repoRoot, "tools", "repo-guard", "repo-guard.config.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));

const violations = [];

function addViolation(rule, relPath, message) {
  const normalizedPath = toPosix(relPath);
  violations.push({
    id: `${rule}:${normalizedPath}`,
    rule,
    path: normalizedPath,
    message
  });
}

const trackedFiles = gitLsFilesAll();

for (const pattern of config.forbiddenTrackedPathGlobs) {
  const matches = gitLsFilesByGlob(pattern);
  for (const relPath of matches) {
    addViolation(
      "forbidden-tracked-path",
      relPath,
      `Tracked file matches forbidden path glob '${pattern}'.`
    );
  }
}

const ignoredSrcDirNames = new Set(config.srcReadmeIgnoreDirNames ?? []);
const srcRoots = uniqueSorted(
  await fg(config.srcRoots, {
    onlyDirectories: true,
    dot: false
  })
);

for (const srcRoot of srcRoots) {
  const subdirs = await fg(`${srcRoot}/**`, {
    onlyDirectories: true,
    dot: false
  });
  const dirsToCheck = uniqueSorted([srcRoot, ...subdirs]);

  for (const relPath of dirsToCheck) {
    if (hasIgnoredSegment(relPath, ignoredSrcDirNames)) {
      continue;
    }
    const readmePath = path.join(repoRoot, relPath, "README.md");
    const lowerReadmePath = path.join(repoRoot, relPath, "readme.md");
    let hasReadme = false;
    try {
      await fs.access(readmePath);
      hasReadme = true;
    } catch {
      try {
        await fs.access(lowerReadmePath);
        hasReadme = true;
      } catch {
        hasReadme = false;
      }
    }

    if (!hasReadme) {
      addViolation(
        "missing-src-readme",
        relPath,
        "Each source directory under src/ must document its purpose and boundaries in README.md."
      );
    }
  }
}

const workspaceDirs = uniqueSorted(
  await fg(config.workspaceRoots, {
    onlyDirectories: true,
    dot: false
  })
);
for (const relPath of workspaceDirs) {
  const readmePath = path.join(repoRoot, relPath, "README.md");
  try {
    await fs.access(readmePath);
  } catch {
    addViolation(
      "missing-workspace-readme",
      relPath,
      "Each top-level workspace directory should include README.md for fast onboarding."
    );
  }
}

for (const rule of config.workspaceShapeRules ?? []) {
  const dirs = await fg(rule.glob, {
    onlyDirectories: true,
    dot: false
  });
  for (const relPath of dirs) {
    for (const requiredEntry of rule.required ?? []) {
      const requiredPath = path.join(repoRoot, relPath, requiredEntry);
      try {
        await fs.access(requiredPath);
      } catch {
        addViolation(
          "workspace-shape",
          path.join(relPath, requiredEntry),
          `Workspace '${relPath}' is missing required entry '${requiredEntry}' for pattern '${rule.glob}'.`
        );
      }
    }
  }
}

const lineCapConfig = config.sourceLineCap;
const lineCapIgnores = new Set();
for (const ignoreGlob of lineCapConfig.ignoreGlobs ?? []) {
  for (const relPath of gitLsFilesByGlob(ignoreGlob)) {
    lineCapIgnores.add(relPath);
  }
}

for (const relPath of trackedFiles) {
  if (lineCapIgnores.has(relPath)) {
    continue;
  }
  const ext = path.extname(relPath);
  if (!lineCapConfig.extensions.includes(ext)) {
    continue;
  }
  const absolutePath = path.join(repoRoot, relPath);
  const contents = await fs.readFile(absolutePath, "utf8");
  const lines = countLines(contents);
  if (lines > lineCapConfig.defaultMaxLines) {
    addViolation(
      "source-line-cap",
      relPath,
      `Source file has ${lines} lines, exceeding cap ${lineCapConfig.defaultMaxLines}. Split modules before they become god files.`
    );
  }
}

const sortedViolations = [...violations].sort((a, b) => {
  const byRule = a.rule.localeCompare(b.rule);
  if (byRule !== 0) {
    return byRule;
  }
  return a.path.localeCompare(b.path);
});

const knownViolationsPath = path.join(repoRoot, config.knownViolationsFile);

if (writeBaseline) {
  const baselineIds = uniqueSorted(sortedViolations.map((violation) => violation.id));
  await fs.writeFile(knownViolationsPath, `${JSON.stringify(baselineIds, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${baselineIds.length} known repo-guard violation(s) to ${config.knownViolationsFile}.`
  );
  process.exit(0);
}

let knownIds = new Set();
if (!strict) {
  try {
    const raw = await fs.readFile(knownViolationsPath, "utf8");
    const parsed = JSON.parse(raw);
    knownIds = new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    knownIds = new Set();
  }
}

const newViolations = strict
  ? sortedViolations
  : sortedViolations.filter((violation) => !knownIds.has(violation.id));

const suppressedCount = strict ? 0 : sortedViolations.length - newViolations.length;

if (debug) {
  console.log(
    JSON.stringify(
      {
        strict,
        knownViolationsPath,
        knownCount: knownIds.size,
        sortedViolationIds: sortedViolations.map((violation) => violation.id),
        newViolationIds: newViolations.map((violation) => violation.id)
      },
      null,
      2
    )
  );
}

if (newViolations.length === 0) {
  if (suppressedCount > 0) {
    console.log(
      `repo-guard: no new violations (suppressed by baseline: ${suppressedCount}, strict total: ${sortedViolations.length}).`
    );
  } else {
    console.log("repo-guard: no violations.");
  }
  process.exit(0);
}

console.error(
  `repo-guard: ${newViolations.length} violation(s) found${strict ? "" : " (new vs baseline)"}.`
);
for (const violation of newViolations) {
  console.error(`- [${violation.rule}] ${violation.path}: ${violation.message}`);
}

if (!strict && suppressedCount > 0) {
  console.error(`suppressed by baseline: ${suppressedCount}`);
}

process.exit(1);
