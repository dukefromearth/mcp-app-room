import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..", "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const roomId = "cfg-e2e-room";

type MockState = {
  healthHits: number;
  createRoomBodies: Array<{ roomId?: string }>;
  stateHits: number;
};

test.setTimeout(120_000);

test("global YAML drives both roomctl and host room bootstrap", async ({ page }) => {
  const roomdPort = await getFreePort();
  const hostPort = await getFreePort();
  const sandboxPort = await getFreePort();
  const roomdBaseUrl = `http://127.0.0.1:${roomdPort}`;

  const mock = createMockRoomd(roomdPort);
  await mock.start();

  const tempDir = await mkdtemp(join(tmpdir(), "mcp-app-room-config-e2e-"));
  const configPath = join(tempDir, "global.yaml");
  await writeFile(
    configPath,
    [
      "roomd:",
      `  baseUrl: \"${roomdBaseUrl}\"`,
      "",
      "host:",
      "  mode: \"room\"",
      `  roomId: \"${roomId}\"`,
      "  ports:",
      `    host: ${hostPort}`,
      `    sandbox: ${sandboxPort}`,
      "",
      "security:",
      "  profile: \"local-dev\"",
      "",
    ].join("\n"),
  );

  const cli = await runCommand(
    npmCmd,
    [
      "run",
      "--silent",
      "roomd:cli",
      "--",
      "--config",
      configPath,
      "health",
      "--output",
      "json",
    ],
    {},
  );

  expect(cli.exitCode).toBe(0);
  const cliPayload = JSON.parse(cli.stdout) as { status: number; body: { ok: boolean } };
  expect(cliPayload.status).toBe(200);
  expect(cliPayload.body.ok).toBe(true);

  const hostProcess = spawn(
    npmCmd,
    [
      "run",
      "--workspace",
      "apps/host-web",
      "start",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        MCP_APP_ROOM_CONFIG: configPath,
        AUTO_LAUNCH_BROWSER: "false",
      },
      stdio: "pipe",
    },
  );

  try {
    await waitForHttpOk(`http://127.0.0.1:${hostPort}/api/host-config`, 45_000);
    const hostConfigResponse = await fetch(`http://127.0.0.1:${hostPort}/api/host-config`);
    expect(hostConfigResponse.ok).toBe(true);
    const hostConfig = (await hostConfigResponse.json()) as {
      mode: string;
      roomdUrl?: string;
      roomId: string;
    };
    expect(hostConfig.mode).toBe("room");
    expect(hostConfig.roomdUrl).toBe(roomdBaseUrl);
    expect(hostConfig.roomId).toBe(roomId);

    await page.goto(`http://127.0.0.1:${hostPort}/?theme=hide`);
    await expect(page.locator("text=Room")).toContainText(roomId, { timeout: 15_000 });

    // End-to-end assertions: same YAML drove both CLI health and host room bootstrap.
    expect(mock.state.healthHits).toBeGreaterThan(0);
    expect(mock.state.createRoomBodies.some((body) => body.roomId === roomId)).toBe(true);
    expect(mock.state.stateHits).toBeGreaterThan(0);
  } finally {
    await terminateProcess(hostProcess);
    await mock.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("roomctl --base-url overrides YAML baseUrl", async () => {
  const yamlPort = await getFreePort();
  const overridePort = await getFreePort();
  const yamlBaseUrl = `http://127.0.0.1:${yamlPort}`;
  const overrideBaseUrl = `http://127.0.0.1:${overridePort}`;

  const yamlMock = createMockHealthServer(yamlPort);
  const overrideMock = createMockHealthServer(overridePort);
  await yamlMock.start();
  await overrideMock.start();

  const tempDir = await mkdtemp(join(tmpdir(), "mcp-app-room-config-precedence-"));
  const configPath = join(tempDir, "global.yaml");
  await writeFile(
    configPath,
    [
      "roomd:",
      `  baseUrl: \"${yamlBaseUrl}\"`,
      "host:",
      "  mode: \"room\"",
      "  roomId: \"demo\"",
      "  ports:",
      "    host: 8080",
      "    sandbox: 8081",
      "security:",
      "  profile: \"local-dev\"",
      "",
    ].join("\n"),
  );

  try {
    const cli = await runCommand(
      npmCmd,
      [
        "run",
        "--silent",
        "roomd:cli",
        "--",
        "--config",
        configPath,
        "--base-url",
        overrideBaseUrl,
        "health",
        "--output",
        "json",
      ],
      {},
    );

    expect(cli.exitCode).toBe(0);
    const payload = JSON.parse(cli.stdout) as { status: number; body: { ok: boolean } };
    expect(payload.status).toBe(200);
    expect(payload.body.ok).toBe(true);
    expect(yamlMock.state.healthHits).toBe(0);
    expect(overrideMock.state.healthHits).toBeGreaterThan(0);
  } finally {
    await yamlMock.stop();
    await overrideMock.stop();
    await rm(tempDir, { recursive: true, force: true });
  }
});

function createMockRoomd(port: number): {
  state: MockState;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const state: MockState = {
    healthHits: 0,
    createRoomBodies: [],
    stateHits: 0,
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      state.healthHits += 1;
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/rooms") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += String(chunk);
      });
      req.on("end", () => {
        try {
          state.createRoomBodies.push(JSON.parse(raw) as { roomId?: string });
        } catch {
          state.createRoomBodies.push({});
        }
        json(res, 201, { ok: true });
      });
      return;
    }

    const roomStateMatch = url.pathname.match(/^\/rooms\/([^/]+)\/state$/);
    if (req.method === "GET" && roomStateMatch) {
      state.stateHits += 1;
      const requestedRoomId = decodeURIComponent(roomStateMatch[1]);
      json(res, 200, {
        state: {
          roomId: requestedRoomId,
          revision: 1,
          mounts: [],
          order: [],
          selectedInstanceId: null,
          invocations: [],
        },
      });
      return;
    }

    const roomEventsMatch = url.pathname.match(/^\/rooms\/([^/]+)\/events$/);
    if (req.method === "GET" && roomEventsMatch) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(
        `event: state-updated\ndata: ${JSON.stringify({
          revision: 1,
          type: "state-updated",
          state: {
            roomId: decodeURIComponent(roomEventsMatch[1]),
            revision: 1,
            mounts: [],
            order: [],
            selectedInstanceId: null,
            invocations: [],
          },
        })}\n\n`,
      );
      return;
    }

    json(res, 404, { error: "not found" });
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return {
    state,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function createMockHealthServer(port: number): {
  state: { healthHits: number };
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const state = { healthHits: 0 };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET" && req.url === "/health") {
      state.healthHits += 1;
      json(res, 200, { ok: true });
      return;
    }
    json(res, 404, { error: "not found" });
  });

  return {
    state,
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      }),
    stop: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,accept");
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const port = address.port;
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

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function runCommand(
  command: string,
  args: string[],
  extraEnv: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...extraEnv,
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

async function terminateProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.killed) {
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
