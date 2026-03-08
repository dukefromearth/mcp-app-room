import { expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

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

test.describe("roomctl lifecycle evidence with full real MCP fixture + host", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let tempDir = "";
  let configPath = "";
  let roomId = "";
  let roomdPort = 0;
  let hostPort = 0;
  let sandboxPort = 0;
  let integrationPort = 0;
  let roomdBaseUrl = "";
  let integrationServerUrl = "";
  let uiResourceUri = "";

  let integrationProcess: ChildProcessWithoutNullStreams | undefined;
  let roomdProcess: ChildProcessWithoutNullStreams | undefined;
  let hostProcess: ChildProcessWithoutNullStreams | undefined;

  test.beforeAll(async () => {
    roomdPort = await getFreePort();
    hostPort = await getFreePort();
    sandboxPort = await getFreePort();
    integrationPort = await getFreePort();

    roomdBaseUrl = `http://127.0.0.1:${roomdPort}`;
    integrationServerUrl = `http://127.0.0.1:${integrationPort}/mcp`;
    roomId = `host-lifecycle-${Date.now()}`;

    tempDir = await mkdtemp(path.join(tmpdir(), "roomctl-host-lifecycle-"));
    configPath = path.join(tempDir, "global.yaml");
    await writeFile(
      configPath,
      [
        "version: 1",
        "roomd:",
        `  baseUrl: \"${roomdBaseUrl}\"`,
        "  bootstrapRooms:",
        `    - \"${roomId}\"`,
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

    integrationProcess = spawn(process.execPath, [fixtureServerPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(integrationPort),
        PLAYWRIGHT_TEST: "1",
      },
      stdio: "pipe",
    });
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
    if (mount.status !== 200 && mount.status !== 409) {
      throw new Error(`mount failed: status=${mount.status} body=${JSON.stringify(mount.body)}`);
    }

    hostProcess = spawn(
      process.execPath,
      ["scripts/run-host.mjs", "start", "--config", configPath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PLAYWRIGHT_TEST: "1",
          AUTO_LAUNCH_BROWSER: "false",
        },
        stdio: "pipe",
      },
    );
    pipeLogs("[host]", hostProcess);
    await waitForHttp(`http://127.0.0.1:${hostPort}/api/host-config`, (status) => status === 200, 45_000);
  });

  test.afterAll(async () => {
    await terminateProcess(hostProcess);
    await terminateProcess(roomdProcess);
    await terminateProcess(integrationProcess);
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("host mount reaches app_initialized and default tool-call await succeeds", async ({
    page,
  }) => {
    // GOTCHA: Host defaults sandbox URL to hostPort+1; tests use arbitrary ports.
    const sandboxUrl = `http://127.0.0.1:${sandboxPort}/sandbox.html`;
    await page.goto(`http://127.0.0.1:${hostPort}/?theme=hide&sandbox=${encodeURIComponent(sandboxUrl)}`);
    await expect(page.locator('[data-instance-id="integration-1"]')).toBeVisible({
      timeout: 40_000,
    });

    const bridgeConnected = await runRoomctl(configPath, [
      "await",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--event",
      "bridge_connected",
      "--max-wait",
      "90s",
      "--poll-interval",
      "200ms",
    ]);
    expect(bridgeConnected.status).toBe(200);
    expect(bridgeConnected.body.event).toBe("bridge_connected");

    const bridgeRevision = Number(bridgeConnected.body.revision ?? 0);
    const appInitialized = await runRoomctl(configPath, [
      "await",
      "--room",
      roomId,
      "--instance",
      "integration-1",
      "--event",
      "app_initialized",
      "--since-revision",
      String(Math.max(0, bridgeRevision - 1)),
      "--max-wait",
      "90s",
      "--poll-interval",
      "200ms",
    ]);
    expect(appInitialized.status).toBe(200);
    expect(appInitialized.body.event).toBe("app_initialized");

    const state = await runRoomctl(configPath, [
      "state",
      "--room",
      roomId,
    ]);
    expect(state.status).toBe(200);
    const instances = (state.body.state?.assurance?.instances ?? []) as Array<Record<string, any>>;
    const assurance = instances.find((instance) => instance.instanceId === "integration-1");
    expect(assurance?.level).toBe("ui_app_initialized");

    const call = await runRoomctl(configPath, [
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
      "5s",
      "--evidence-poll-interval",
      "100ms",
    ]);
    expect(call.status).toBe(200);
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

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

function pipeLogs(prefix: string, child: ChildProcessWithoutNullStreams): void {
  child.stdout.on("data", (chunk) => {
    process.stdout.write(`${prefix} ${String(chunk)}`);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(`${prefix} ${String(chunk)}`);
  });
}

async function terminateProcess(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  const exitedOnTerm = await Promise.race([
    once(child, "exit").then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (exitedOnTerm) {
    return;
  }

  child.kill("SIGKILL");
  await once(child, "exit").catch(() => undefined);
}

async function waitForHttp(
  url: string,
  isReady: (status: number) => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (isReady(response.status)) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
