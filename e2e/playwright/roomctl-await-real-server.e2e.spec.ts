import { expect, test } from "@playwright/test";

import { RealMcpHarness } from "./support/real-mcp-harness";

test.describe("roomctl tool-call default await with local real server", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);
  // GOTCHA: this suite intentionally does not boot host-web, so app_initialized
  // lifecycle phase is expected to remain absent unless explicitly injected.

  const harness = new RealMcpHarness(process.cwd());
  let uiResourceUri = "";

  test.beforeAll(async () => {
    await harness.start("await-real");

    const create = await harness.roomctl(["create", "--room", harness.roomId]);
    if (create.status !== 201 && create.status !== 200) {
      throw new Error(`create failed: status=${create.status} body=${JSON.stringify(create.body)}`);
    }

    const inspect = await harness.roomctl([
      "inspect",
      "--server",
      harness.integrationServerUrl,
    ]);
    if (inspect.status !== 200) {
      throw new Error(`inspect failed: status=${inspect.status} body=${JSON.stringify(inspect.body)}`);
    }
    uiResourceUri = String(inspect.body.recommendedUiResourceUri ?? "");
    if (!uiResourceUri) {
      throw new Error(`inspect returned no recommendedUiResourceUri: ${JSON.stringify(inspect.body)}`);
    }

    const mount = await harness.roomctl([
      "mount",
      "--room",
      harness.roomId,
      "--instance",
      "integration-1",
      "--server",
      harness.integrationServerUrl,
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
    await harness.stop();
  });

  test("await app_initialized times out before any host lifecycle events", async () => {
    const awaited = await harness.roomctl([
      "await",
      "--room",
      harness.roomId,
      "--instance",
      "integration-1",
      "--phase",
      "app_initialized",
      "--max-wait",
      "1500ms",
      "--poll-interval",
      "100ms",
    ]);
    expect(awaited.status).toBe(408);
    expect(awaited.body.code).toBe("PHASE_TIMEOUT");
  });

  test("tool-call defaults to await and fails when app_initialized phase is missing", async () => {
    const defaultCall = await harness.roomctl([
      "tool-call",
      "--room",
      harness.roomId,
      "--instance",
      "integration-1",
      "--name",
      "get-time",
      "--arguments",
      "{}",
      "--phase-max-wait",
      "1500ms",
      "--phase-poll-interval",
      "100ms",
    ]);
    expect(defaultCall.status).toBe(412);
    expect(defaultCall.body.code).toBe("REQUIRED_PHASE_MISSING");
    expect(defaultCall.body.details.expectedPhase).toBe("app_initialized");
    expect(defaultCall.body.details.awaitInferred).toBe(true);
  });

  test("readiness reports blockers when app_initialized is missing", async () => {
    const readiness = await harness.roomctl([
      "readiness",
      "--room",
      harness.roomId,
      "--instance",
      "integration-1",
      "--phase",
      "app_initialized",
    ]);
    expect(readiness.status).toBe(200);
    expect(readiness.body.ready).toBe(false);
    expect(Array.isArray(readiness.body.blockers)).toBe(true);
    expect(String(readiness.body.recommendedNextCommand ?? "")).toContain(
      "roomctl await --room",
    );
  });

  test("strict-mode stress only applies one accepted lifecycle progression per session", async () => {
    const instanceId = "integration-1";
    const state = await harness.roomctl(["state", "--room", harness.roomId]);
    expect(state.status).toBe(200);

    const mount = (state.body.state?.mounts ?? []).find((item: any) => item.instanceId === instanceId);
    expect(mount?.mountNonce).toBeTruthy();
    const mountNonce = String(mount.mountNonce);
    const sessionId = `stress-${Date.now()}`;

    const postLifecycle = async (seq: number, phase: string) => {
      const response = await fetch(
        `${harness.roomdBaseUrl}/rooms/${encodeURIComponent(harness.roomId)}/instances/${encodeURIComponent(instanceId)}/lifecycle`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mountNonce,
            sessionId,
            seq,
            phase,
          }),
        },
      );
      return (await response.json()) as Record<string, any>;
    };

    const first = await postLifecycle(1, "bridge_connected");
    expect(first.ok).toBe(true);
    expect(first.accepted).toBe("applied");

    const duplicate = await postLifecycle(1, "bridge_connected");
    expect(duplicate.ok).toBe(true);
    expect(duplicate.accepted).toBe("duplicate");

    const latest = await harness.roomctl(["state", "--room", harness.roomId]);
    expect(latest.status).toBe(200);
    const lifecycleEntry = (latest.body.state?.lifecycle?.instances ?? []).find(
      (item: any) => item.instanceId === instanceId,
    );
    expect(lifecycleEntry?.seq).toBe(1);
    expect(lifecycleEntry?.phase).toBe("bridge_connected");
  });
});
