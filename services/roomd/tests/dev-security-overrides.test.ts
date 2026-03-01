import { describe, expect, it } from "vitest";
import {
  resolveRemoteHttpOriginAllowlist,
  resolveStdioAllowlist,
} from "../src/dev-security-overrides";

describe("dev security overrides", () => {
  it("keeps explicit stdio allowlist even when dangerous mode is enabled", () => {
    expect(resolveStdioAllowlist(["node", "uvx"], true)).toEqual([
      "node",
      "uvx",
    ]);
  });

  it("defaults stdio allowlist to wildcard when dangerous mode is enabled", () => {
    expect(resolveStdioAllowlist([], true)).toEqual(["*"]);
  });

  it("does not change stdio allowlist when dangerous mode is disabled", () => {
    expect(resolveStdioAllowlist([], false)).toEqual([]);
  });

  it("keeps explicit remote origin allowlist even when dangerous mode is enabled", () => {
    expect(
      resolveRemoteHttpOriginAllowlist(["https://example.com"], true),
    ).toEqual(["https://example.com"]);
  });

  it("defaults remote origin allowlist to wildcard when dangerous mode is enabled", () => {
    expect(resolveRemoteHttpOriginAllowlist([], true)).toEqual(["*"]);
  });

  it("does not change remote origin allowlist when dangerous mode is disabled", () => {
    expect(resolveRemoteHttpOriginAllowlist([], false)).toEqual([]);
  });
});
