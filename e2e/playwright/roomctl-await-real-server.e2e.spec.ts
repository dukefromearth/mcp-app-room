import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getFreePort,
  pipeLogs,
  runCommand,
  terminateProcess,
  waitForHttp,
} from "./support/process-utils";

type Envelope = {
  status: number;
  body: Record<string, any>;
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const repoRoot = process.cwd();
const fixtureServerPath = path.join(
  repoRoot,
  "e2e",
  "fixtures",
  "integration-server",
  "main.mjs",
);

test.describe("roomctl tool-call default await with local real server", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);
  // GOTCHA: this suite intentionally does not boot host-web, so app_initialized
  // evidence is expected to remain absent unless explicitly injected.

  let tempDir = "";
  let configPath = "";
  let roomId = "";
  let roomdPort = 0;
  let integrationPort = 0;
  let roomdBaseUrl = "";
  let integrationServerUrl = "";
  let uiResourceUri = "";

  let integrationProcess: ChildProcessWithoutNullStreams | undefined;
  let roomdProcess: ChildProcessWithoutNullStreams | undefined;

  test.beforeAll(async () => {
    roomdPort = await getFreePort();
    const hostPort = await getFreePort();
    const sandboxPort = await getFreePort();
    integrationPort = await getFreePort();

    roomdBaseUrl = `http://127.0.0.1:${roomdPort}`;
    integrationServerUrl = `http://127.0.0.1:${integrationPort}/mcp`;
    roomId = `await-real-${Date.now()}`;

    tempDir = await mkdtemp(path.join(tmpdir(), "roomctl-await-real-"));
    configPath = path.join(tempDir, "global.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "roomd:",
        `  baseUrl: \"${roomdBaseUrl}\"`,
        "host:",
        "  mode: \"room\"",
        `  roomId: \"${roomId}\"`,
        "  ports:",
        `    host: ${hostPort}`,
        `    sandbox: ${sandboxPort}`,
        "  browser:",
        "    remoteDebuggingPort: 9222",
        "  servers:",
        `    - \"${integrationServerUrl}\"`,
        "security:",
        "  profile: \"local-dev\"",
        "",
      ].join("\n"),
    );

    integrationProcess = spawn(
      process.execPath,
      [fixtureServerPath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PORT: String(integrationPort),
          PLAYWRIGHT_TEST: "1",
        },
        stdio: "pipe",
      },
    );
    pipeLogs("[fixture-mcp]", integrationProcess);
    await waitForHttp(integrationServerUrl, (status) => status > 0, 20_000);

    roomdProcess = spawn(
      process.execPath,
      ["scripts/run-roomd.mjs", "start", "--config", configPath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_TEST: "1",
        },
        stdio: "pipe",
      },
    );
    pipeLogs("[roomd]", roomdProcess);
    await waitForHttp(`${roomdBaseUrl}/health`, (status) => status === 200, 30_000);

    const create = await runRoomctl(configPath, ["create", "--room", roomId]);
    if (create.status !== 201 && create.status !== 200) {
      throw new Error(`create failed: status=${create.status} body=${JSON.stringify(create.body)}`);
    }

    const inspect = await runRoomctl(configPath, [
      "inspect",
      "--server",
      integrationServerUrl,
    ]);
    if (inspect.status !== 200) {
      throw new Error(`inspect failed: status=${inspect.status} body=${JSON.stringify(inspect.body)}`);
    }
    uiResourceUri = String(inspect.body.recommendedUiResourceUri ?? "");
    if (!uiResourceUri) {
      throw new Error(`inspect returned no recommendedUiResourceUri: ${JSON.stringify(inspect.body)}`);
    }

    const mount = await runRoomctl(configPath, [
      "mount",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--server",
      integrationServerUrl,
      "--container",
      "0,0,4,8",
      "--ui-resource-uri",
      uiResourceUri,
    ]);
    if (mount.status !== 200) {
      throw new Error(`mount failed: status=${mount.status} body=${JSON.stringify(mount.body)}`);
    }
  });

  test.afterAll(async () => {
    await terminateProcess(roomdProcess);
    await terminateProcess(integrationProcess);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("await app_initialized times out before any host lifecycle events", async () => {
    const awaited = await runRoomctl(configPath, [
      "await",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--event",
      "app_initialized",
      "--max-wait",
      "1500ms",
      "--poll-interval",
      "100ms",
    ]);
    expect(awaited.status).toBe(408);
    expect(awaited.body.code).toBe("EVIDENCE_TIMEOUT");
  });

  test("tool-call defaults to await and fails when app_initialized evidence is missing", async () => {
    const defaultCall = await runRoomctl(configPath, [
      "tool-call",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--name",
      "get-time",
      "--arguments",
      "{}",
      "--evidence-max-wait",
      "1500ms",
      "--evidence-poll-interval",
      "100ms",
    ]);
    expect(defaultCall.status).toBe(412);
    expect(defaultCall.body.code).toBe("REQUIRED_EVIDENCE_MISSING");
    expect(defaultCall.body.details.requiredEvidence).toEqual(["app_initialized"]);
    expect(defaultCall.body.details.awaitInferred).toBe(true);
  });

  test("--no-await bypasses default lifecycle waiting", async () => {
    const noAwaitCall = await runRoomctl(configPath, [
      "tool-call",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--name",
      "get-time",
      "--arguments",
      "{}",
      "--no-await",
    ]);
    expect(noAwaitCall.status).toBe(200);
    const claims = noAwaitCall.body.claims as { unknown?: string[] } | undefined;
    expect(claims?.unknown?.some((claim) => claim.includes("unknown"))).toBeTruthy();
  });
});

async function runRoomctl(configPath: string, args: string[]): Promise<Envelope> {
  const command = await runCommand(
    npmCmd,
    ["run", "--silent", "roomd:cli", "--", ...args, "--output", "json"],
    repoRoot,
    { MCP_APP_ROOM_CONFIG: configPath },
  );
  if (command.exitCode !== 0) {
    throw new Error(`roomctl failed: ${command.stderr || command.stdout}`);
  }
  return JSON.parse(command.stdout) as Envelope;
}
