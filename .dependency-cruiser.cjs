const base = require("./.dependency-cruiser.base.cjs");

module.exports = {
  ...base,
  forbidden: [
    ...base.forbidden,
    {
      name: "roomd-foundation-cannot-reach-runtime",
      severity: "error",
      comment:
        "Roomd foundation modules should remain framework/runtime-independent.",
      from: { path: "^services/roomd/src/(types|schema|hash)[.]ts$" },
      to: { path: "^services/roomd/src/(store|mcp|server)[.]ts$", reachable: true },
    },
    {
      name: "roomd-domain-cannot-reach-adapters",
      severity: "error",
      comment:
        "Room domain logic should not depend on transport/session adapters.",
      from: { path: "^services/roomd/src/store[.]ts$" },
      to: { path: "^services/roomd/src/mcp[.]ts$", reachable: true },
    },
    {
      name: "roomd-sdk-imports-only-at-boundary",
      severity: "error",
      comment:
        "@modelcontextprotocol SDK imports belong to adapter/composition boundaries.",
      from: {
        path: "^services/roomd/src/",
        pathNot: "^services/roomd/src/(mcp|server)[.]ts$",
      },
      to: {
        dependencyTypes: ["npm"],
        path: "(^|/)node_modules/@modelcontextprotocol/(sdk|ext-apps)(/|$)",
      },
    },
    {
      name: "host-foundation-cannot-reach-runtime",
      severity: "error",
      comment:
        "Host foundation modules should not depend on runtime/integration modules.",
      from: { path: "^apps/host-web/src/(theme|host-styles)[.]ts$" },
      to: {
        path: "^apps/host-web/src/(room-canvas|implementation|sandbox)[.]tsx?$",
        reachable: true,
      },
    },
    {
      name: "host-shell-cannot-import-sdk-directly",
      severity: "error",
      comment:
        "Host shell files should consume app integration through local abstractions.",
      from: { path: "^apps/host-web/src/(index|room-canvas)[.]tsx?$" },
      to: {
        dependencyTypes: ["npm"],
        path: "(^|/)node_modules/@modelcontextprotocol/(sdk|ext-apps)(/|$)",
      },
    },
    {
      name: "host-sdk-imports-only-in-integration",
      severity: "error",
      comment:
        "@modelcontextprotocol SDK imports should be isolated to integration modules.",
      from: {
        path: "^apps/host-web/src/",
        pathNot: "^apps/host-web/src/(implementation|sandbox)[.]ts$",
      },
      to: {
        dependencyTypes: ["npm"],
        path: "(^|/)node_modules/@modelcontextprotocol/(sdk|ext-apps)(/|$)",
      },
    },
  ],
};
