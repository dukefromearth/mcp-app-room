import { test, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { getFreePort, runCommand, terminateProcess, waitForHttp } from "./support/process-utils";

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
    repoRoot,
    process.env,
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
    await waitForHttp(`http://127.0.0.1:${hostPort}/api/host-config`, (status) => status === 200, 45_000);
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
      repoRoot,
      process.env,
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
  const createdRooms = new Set<string>();
  const state: MockState = {
    healthHits: 0,
    createRoomBodies: [],
    stateHits: 0,
  };

  const emptyRoomState = (roomIdValue: string) => ({
    roomId: roomIdValue,
    revision: 1,
    mounts: [],
    order: [],
    selectedInstanceId: null,
    invocations: [],
    lifecycle: {
      instances: [],
    },
    assurance: {
      generatedAt: "2026-03-01T00:00:00Z",
      instances: [],
    },
  });

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
        let roomIdValue = "";
        try {
          const parsed = JSON.parse(raw) as { roomId?: string };
          state.createRoomBodies.push(parsed);
          roomIdValue = String(parsed.roomId ?? "");
        } catch {
          state.createRoomBodies.push({});
        }
        const created = roomIdValue.length > 0 && !createdRooms.has(roomIdValue);
        if (roomIdValue.length > 0) {
          createdRooms.add(roomIdValue);
        }
        json(res, created ? 201 : 200, {
          ok: true,
          created,
          state: emptyRoomState(roomIdValue || roomId),
        });
      });
      return;
    }

    const roomStateMatch = url.pathname.match(/^\/rooms\/([^/]+)\/state$/);
    if (req.method === "GET" && roomStateMatch) {
      state.stateHits += 1;
      const requestedRoomId = decodeURIComponent(roomStateMatch[1]);
      json(res, 200, {
        ok: true,
        state: emptyRoomState(requestedRoomId),
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
            ...emptyRoomState(decodeURIComponent(roomEventsMatch[1])),
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
