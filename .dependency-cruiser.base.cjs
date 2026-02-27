/** @type {import("dependency-cruiser").IConfiguration} */
const TEST_PATH = [
  "(^|/)(test|tests|__tests__|__mocks__|fixtures|e2e)(/|$)",
  "[.](?:spec|test)\\.[cm]?[jt]sx?$",
];

const PROD_SRC_PATH = "^(apps|services)/[^/]+/src/";
const BUILD_ARTIFACT_PATH = "(^|/)(dist|build|coverage|out|\\.next|\\.turbo)(/|$)";

module.exports = {
  forbidden: [
    {
      name: "no-circular-deps",
      severity: "error",
      comment: "Cycles hide ownership and increase blast radius; break them.",
      from: { path: PROD_SRC_PATH },
      to: { path: PROD_SRC_PATH, circular: true },
    },
    {
      name: "no-prod-to-tests",
      severity: "error",
      comment: "Production source must never depend on tests or test helpers.",
      from: { path: PROD_SRC_PATH },
      to: { path: TEST_PATH },
    },
    {
      name: "no-prod-to-build-artifacts",
      severity: "error",
      comment: "Production source must never import generated output.",
      from: { path: PROD_SRC_PATH },
      to: { path: BUILD_ARTIFACT_PATH, pathNot: ["(^|/)node_modules/"] },
    },
    {
      name: "no-prod-to-dev-dependencies",
      severity: "error",
      comment:
        "Runtime source cannot depend on packages declared only as devDependencies.",
      from: { path: PROD_SRC_PATH },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
        pathNot: ["^node_modules/@types/"],
      },
    },
    {
      name: "apps-cannot-import-service-source",
      severity: "error",
      comment: "UI apps must not couple directly to service implementation source.",
      from: { path: "^apps/[^/]+/src/" },
      to: { path: "^services/[^/]+/src/", reachable: true },
    },
    {
      name: "services-cannot-import-app-source",
      severity: "error",
      comment: "Service code must stay independent of app implementation details.",
      from: { path: "^services/[^/]+/src/" },
      to: { path: "^apps/[^/]+/src/", reachable: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "Orphans usually indicate dead code; allowlist intentional entrypoints only.",
      from: {
        orphan: true,
        path: "^(apps|services)/[^/]+/src/.*[.](?:[cm]?[jt]sx?)$",
        pathNot: [
          "^apps/[^/]+/src/index[.]tsx?$",
          "^apps/[^/]+/src/sandbox[.]ts$",
          "^services/[^/]+/src/server[.]ts$",
          "[.]d[.]ts$",
        ],
      },
      to: {},
    },
  ],
  required: [
    {
      name: "host-entrypoint-must-use-room-canvas",
      severity: "error",
      comment:
        "The host entrypoint should compose the canvas host instead of bypassing it.",
      module: { path: "^apps/host-web/src/index[.]tsx$" },
      to: { path: "^apps/host-web/src/room-canvas[.]tsx$" },
    },
    {
      name: "roomd-server-must-use-room-store",
      severity: "error",
      comment: "The roomd composition root should route through RoomStore.",
      module: { path: "^services/roomd/src/server[.]ts$" },
      to: { path: "^services/roomd/src/store[.]ts$" },
    },
  ],
  options: {
    combinedDependencies: true,
    tsPreCompilationDeps: true,
    extraExtensionsToScan: [".css", ".html"],
    doNotFollow: { path: ["(^|/)node_modules/"] },
    includeOnly: [
      "^(apps|services)/",
      "(^|/)node_modules/@modelcontextprotocol/",
    ],
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    skipAnalysisNotInRules: true,
  },
};
