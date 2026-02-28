import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RealMcpSessionFactory } from "../src/mcp";
import { RoomStore } from "../src/store";
import { commandEnvelope } from "./store.fixtures";

const FIXTURE_SERVER_PATH = path.resolve(
  process.cwd(),
  "tests/fixtures/stdio-fixture-server.mjs",
);

function buildStdioServerDescriptor(options?: {
  env?: Record<string, string>;
}): string {
  const params = new URLSearchParams();
  params.set("command", process.execPath);
  params.append("arg", FIXTURE_SERVER_PATH);

  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      params.set(`env.${key}`, value);
    }
  }

  return `stdio://spawn?${params.toString()}`;
}

describe("stdio transport adapter", () => {
  it("rejects stdio targets when command is not allowlisted", async () => {
    const factory = new RealMcpSessionFactory({
      stdioCommandAllowlist: [],
    });
    const store = new RoomStore(factory, {
      stdioCommandAllowlist: [],
    });

    await expect(
      store.inspectServer(buildStdioServerDescriptor()),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "SERVER_NOT_ALLOWLISTED",
    });
  });

  it("mounts a stdio descriptor and serves tools/list", async () => {
    const factory = new RealMcpSessionFactory({
      stdioCommandAllowlist: [process.execPath],
    });
    const store = new RoomStore(factory, {
      stdioCommandAllowlist: [process.execPath],
      eventWindowSize: 10,
      invocationHistoryLimit: 10,
      idempotencyKeyLimit: 10,
    });

    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-stdio",
        server: buildStdioServerDescriptor(),
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    const toolsPage = await store.listInstanceTools("demo", "inst-stdio");
    const body = toolsPage as { tools: Array<{ name: string }> };
    expect(body.tools.some((tool) => tool.name === "fixture-tool")).toBe(true);

    const state = store.getState("demo");
    expect(state.mounts[0].session.transport).toBe("stdio");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount", {
        type: "unmount",
        instanceId: "inst-stdio",
      }),
    );
  });

  it("terminates stdio subprocess after last unmount", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roomd-stdio-"));
    const markerPath = path.join(tempRoot, "stdio-exit.marker");

    const factory = new RealMcpSessionFactory({
      stdioCommandAllowlist: [process.execPath],
    });
    const store = new RoomStore(factory, {
      stdioCommandAllowlist: [process.execPath],
      eventWindowSize: 10,
      invocationHistoryLimit: 10,
      idempotencyKeyLimit: 10,
    });

    store.createRoom("demo");

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-mount", {
        type: "mount",
        instanceId: "inst-stdio",
        server: buildStdioServerDescriptor({
          env: {
            ROOMD_STDIO_EXIT_MARKER: markerPath,
          },
        }),
        container: { x: 0, y: 0, w: 6, h: 4 },
      }),
    );

    await store.applyCommand(
      "demo",
      commandEnvelope("cmd-unmount", {
        type: "unmount",
        instanceId: "inst-stdio",
      }),
    );

    await expect(waitForFile(markerPath, 5000)).resolves.toBe(true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});

async function waitForFile(filePath: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}
