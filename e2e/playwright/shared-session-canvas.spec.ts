import { test, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ROOMD_PORT = 8090;
const ROOMD_BASE_URL = `http://localhost:${ROOMD_PORT}`;

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

  await page.goto(`/?mode=room&theme=hide&roomd=${encodeURIComponent(ROOMD_BASE_URL)}&room=${encodeURIComponent(roomId)}`);
  await expect(page.locator('[data-testid="room-canvas"]')).toBeVisible();

  await sendCommand(roomId, "cmd-mount", {
    type: "mount",
    instanceId: "inst-1",
    server: serverUrl,
    toolName: "get-time",
    container: { x: 0, y: 0, w: 6, h: 4 },
    initialInput: {},
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

  await createRoom(roomId);

  const mountPayload = {
    type: "mount",
    instanceId: "inst-1",
    server: serverUrl,
    toolName: "get-time",
    container: { x: 0, y: 0, w: 6, h: 4 },
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
  expect(replayEvent.event).toBe("snapshot-reset");

  await page.goto(`/?mode=room&theme=hide&roomd=${encodeURIComponent(ROOMD_BASE_URL)}&room=${encodeURIComponent(roomId)}`);
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

async function createRoom(roomId: string): Promise<void> {
  const response = await fetch(`${ROOMD_BASE_URL}/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ roomId }),
  });

  if (response.status !== 201 && response.status !== 409) {
    throw new Error(`Failed to create room: ${response.status}`);
  }
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
