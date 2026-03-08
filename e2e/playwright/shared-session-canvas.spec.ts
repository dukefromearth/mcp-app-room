import { test, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

const ROOMD_PORT = 8090;
const ROOMD_BASE_URL = `http://localhost:${ROOMD_PORT}`;
const STDIO_FIXTURE_SERVER_PATH = path.resolve(
  process.cwd(),
  "services/roomd/tests/fixtures/stdio-fixture-server.mjs",
);

let roomdProcess: ChildProcessWithoutNullStreams;

test.beforeAll(async () => {
  roomdProcess = spawn(
    "npm",
    ["run", "--workspace", "services/roomd", "start"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ROOMD_PORT: String(ROOMD_PORT),
        ROOMD_EVENT_WINDOW: "2",
        DANGEROUSLY_ALLOW_STDIO: "true",
      },
      stdio: "pipe",
    },
  );

  roomdProcess.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  await waitForHealth();
});

test.afterAll(async () => {
  if (!roomdProcess.killed) {
    roomdProcess.kill("SIGTERM");
  }
});

test("room canvas responds to mount/hide/show/unmount commands", async ({ page }) => {
  const roomId = `room-${Date.now()}-a`;
  const serverUrl = await getAnyServerUrl();
  const uiResourceUri = await resolveUiResourceUri(serverUrl);

  await page.goto(`/?mode=room&theme=hide&debug=1&roomd=${encodeURIComponent(ROOMD_BASE_URL)}&room=${encodeURIComponent(roomId)}`);
  await expect(page.locator("text=status")).toBeVisible();
  await expect(page.locator("code", { hasText: "connected" })).toBeVisible();

  await sendCommand(roomId, "cmd-mount", {
    type: "mount",
    instanceId: "inst-1",
    server: serverUrl,
    container: { x: 0, y: 0, w: 6, h: 4 },
    ...(uiResourceUri ? { uiResourceUri } : {}),
  });

  const tile = page.locator('[data-instance-id="inst-1"]');
  await expect(tile).toBeVisible({ timeout: 15000 });

  await sendCommand(roomId, "cmd-hide", {
    type: "hide",
    instanceId: "inst-1",
  });
  await expect(tile).toBeHidden({ timeout: 15000 });

  await sendCommand(roomId, "cmd-show", {
    type: "show",
    instanceId: "inst-1",
  });
  await expect(tile).toBeVisible({ timeout: 15000 });

  await sendCommand(roomId, "cmd-unmount", {
    type: "unmount",
    instanceId: "inst-1",
  });
  await expect(tile).toHaveCount(0, { timeout: 15000 });
});

test("idempotency, reconnect, and replay reset behavior", async ({ page }) => {
  const roomId = `room-${Date.now()}-b`;
  const serverUrl = await getAnyServerUrl();
  const uiResourceUri = await resolveUiResourceUri(serverUrl);

  await createRoom(roomId);

  const mountPayload = {
    type: "mount",
    instanceId: "inst-1",
    server: serverUrl,
    container: { x: 0, y: 0, w: 6, h: 4 },
    ...(uiResourceUri ? { uiResourceUri } : {}),
  };

  const first = await sendCommand(roomId, "idem-1", mountPayload);
  const second = await sendCommand(roomId, "idem-1", mountPayload);
  expect(second.status).toBe(first.status);
  expect(second.body.revision).toBe(first.body.revision);

  const conflict = await sendCommand(roomId, "idem-1", {
    ...mountPayload,
    instanceId: "inst-2",
  });
  expect(conflict.status).toBe(409);

  await sendCommand(roomId, "cmd-hide", {
    type: "hide",
    instanceId: "inst-1",
  });
  await sendCommand(roomId, "cmd-show", {
    type: "show",
    instanceId: "inst-1",
  });

  const replayEvent = await readFirstSseEvent(
    `${ROOMD_BASE_URL}/rooms/${encodeURIComponent(roomId)}/events?sinceRevision=0`,
  );
  expect(["snapshot-reset", "state-updated"]).toContain(replayEvent.event);
  expect((replayEvent.data.state as Record<string, unknown>).roomId).toBe(roomId);

  await page.goto(`/?mode=room&theme=hide&debug=1&roomd=${encodeURIComponent(ROOMD_BASE_URL)}&room=${encodeURIComponent(roomId)}`);
  const tile = page.locator('[data-instance-id="inst-1"]');
  await expect(tile).toBeVisible({ timeout: 15000 });

  await sendCommand(roomId, "cmd-hide-after-connect", {
    type: "hide",
    instanceId: "inst-1",
  });
  await expect(tile).toBeHidden({ timeout: 15000 });

  await page.reload();
  await expect(tile).toBeHidden({ timeout: 15000 });
});

test("handles mounts without explicit UI resources", async ({ page }) => {
  const roomId = `room-${Date.now()}-no-ui`;

  await page.goto(`/?mode=room&theme=hide&debug=1&roomd=${encodeURIComponent(ROOMD_BASE_URL)}&room=${encodeURIComponent(roomId)}`);
  await expect(page.locator("code", { hasText: "connected" })).toBeVisible();

  const mount = await sendCommand(roomId, "cmd-mount-stdio-no-ui", {
    type: "mount",
    instanceId: "inst-stdio",
    server: buildStdioServerDescriptor(),
    container: { x: 0, y: 0, w: 6, h: 4 },
  });
  expect(mount.status).toBe(200);
  const mounted = (mount.body.state.mounts as Array<{ instanceId: string; uiResourceUri?: string }>)
    .find((candidate) => candidate.instanceId === "inst-stdio");
  expect(mounted?.uiResourceUri).toBeUndefined();

  const tile = page.locator('[data-instance-id="inst-stdio"]');
  await expect(tile).toBeVisible({ timeout: 15000 });
});

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 20000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ROOMD_BASE_URL}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("roomd health check failed");
}

async function getAnyServerUrl(): Promise<string> {
  const response = await fetch("http://localhost:8080/api/servers");
  if (!response.ok) {
    throw new Error(`Failed to fetch servers: ${response.status}`);
  }
  const servers = (await response.json()) as string[];
  if (servers.length === 0) {
    throw new Error("No MCP servers configured");
  }
  return servers[0];
}

function buildStdioServerDescriptor(): string {
  const params = new URLSearchParams();
  params.set("command", process.execPath);
  params.append("arg", STDIO_FIXTURE_SERVER_PATH);
  return `stdio://spawn?${params.toString()}`;
}

async function createRoom(roomId: string): Promise<void> {
  const response = await fetch(`${ROOMD_BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ roomId }),
  });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Failed to create room: ${response.status}`);
  }
}

async function resolveUiResourceUri(serverUrl: string): Promise<string | undefined> {
  const response = await fetch(`${ROOMD_BASE_URL}/inspect/server`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ server: serverUrl }),
  });

  if (!response.ok) {
    throw new Error(`Failed to inspect server: ${response.status}`);
  }

  const body = (await response.json()) as {
    uiCandidates?: string[];
    recommendedUiResourceUri?: string;
  };

  if (body.recommendedUiResourceUri) {
    return body.recommendedUiResourceUri;
  }

  return body.uiCandidates?.[0];
}

async function sendCommand(
  roomId: string,
  idempotencyKey: string,
  command: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const response = await fetch(
    `${ROOMD_BASE_URL}/rooms/${encodeURIComponent(roomId)}/commands`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey, command }),
    },
  );

  const body = (await response.json()) as any;
  return { status: response.status, body };
}

async function readFirstSseEvent(
  url: string,
): Promise<{ event: string; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
      },
      signal: controller.signal,
    });

    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        continue;
      }

      const block = buffer.slice(0, boundary);
      const lines = block.split("\n");
      let event = "message";
      let data = "{}";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        }
        if (line.startsWith("data:")) {
          data = line.slice("data:".length).trim();
        }
      }

      return {
        event,
        data: JSON.parse(data) as Record<string, unknown>,
      };
    }

    throw new Error("No SSE event received");
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
