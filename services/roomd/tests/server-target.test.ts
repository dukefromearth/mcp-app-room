import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema } from "../src/schema";
import {
  isValidServerTarget,
  normalizeServerTarget,
  parseServerDescriptor,
} from "../src/server-target";

describe("server target descriptor parsing", () => {
  it("keeps HTTP URL target backward compatible", () => {
    const descriptor = parseServerDescriptor("http://localhost:3001/mcp");
    expect(descriptor).toEqual({
      kind: "http",
      url: "http://localhost:3001/mcp",
    });

    expect(normalizeServerTarget("http://localhost:3001/mcp")).toBe(
      "http://localhost:3001/mcp",
    );
  });

  it("parses stdio descriptor with command args env and cwd", () => {
    const descriptor = parseServerDescriptor(
      "stdio://spawn?command=node&arg=server.mjs&arg=--debug&cwd=%2Ftmp&env.NODE_ENV=test&env.API_KEY=secret",
    );

    expect(descriptor).toEqual({
      kind: "stdio",
      command: "node",
      args: ["server.mjs", "--debug"],
      cwd: "/tmp",
      env: {
        NODE_ENV: "test",
        API_KEY: "secret",
      },
    });

    expect(
      normalizeServerTarget(
        "stdio://spawn?env.API_KEY=secret&arg=server.mjs&command=node&env.NODE_ENV=test&cwd=%2Ftmp&arg=--debug",
      ),
    ).toBe(
      "stdio://spawn?command=node&arg=server.mjs&arg=--debug&cwd=%2Ftmp&env.API_KEY=secret&env.NODE_ENV=test",
    );
  });

  it("rejects stdio descriptor without command", () => {
    expect(isValidServerTarget("stdio://spawn?arg=server.mjs")).toBe(false);

    expect(() =>
      commandEnvelopeSchema.parse({
        idempotencyKey: "cmd-1",
        command: {
          type: "mount",
          instanceId: "inst-1",
          server: "stdio://spawn?arg=server.mjs",
          container: { x: 0, y: 0, w: 6, h: 4 },
        },
      }),
    ).toThrow();
  });

  it("rejects unknown protocol", () => {
    expect(isValidServerTarget("file:///tmp/server")).toBe(false);
  });
});
