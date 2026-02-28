export const CONFORMANCE_PACKAGE_VERSION = "0.1.15";
export const CONFORMANCE_SPEC_VERSION = "2025-11-25";
export const TIER2_THRESHOLD = 0.8;

export const APPLICABLE_CLIENT_SCENARIOS = [
  "initialize",
  "tools_call",
] as const;

export type ApplicableClientScenario =
  (typeof APPLICABLE_CLIENT_SCENARIOS)[number];
