import { describe, expect, it } from "vitest";

import { appendRoomEvidence, buildRoomAssurance } from "../src/store/evidence";
import type { RoomEvidence, RoomMount } from "../src/types";

describe("store evidence seams", () => {
  it("appends evidence with bounded history and cloned details", () => {
    const evidence: RoomEvidence[] = [];
    const details = { nested: { ok: true } };

    let counter = appendRoomEvidence({
      evidence,
      evidenceCounter: 1,
      evidenceHistoryLimit: 2,
      revision: 1,
      payload: {
        source: "roomd",
        event: "mount_applied",
        details,
      },
    });
    details.nested.ok = false;

    expect(evidence).toHaveLength(1);
    expect(evidence[0].details).toEqual({ nested: { ok: true } });

    counter = appendRoomEvidence({
      evidence,
      evidenceCounter: counter,
      evidenceHistoryLimit: 2,
      revision: 2,
      payload: {
        source: "roomd",
        event: "rpc_sent",
      },
    });

    appendRoomEvidence({
      evidence,
      evidenceCounter: counter,
      evidenceHistoryLimit: 2,
      revision: 3,
      payload: {
        source: "roomd",
        event: "rpc_succeeded",
      },
    });

    expect(counter).toBe(3);
    expect(evidence).toHaveLength(2);
    expect(evidence[0].revision).toBe(2);
    expect(evidence[1].revision).toBe(3);
    expect(evidence[0].evidenceId).toBe("ev-2-2");
    expect(evidence[1].evidenceId).toBe("ev-3-3");
  });

  it("builds assurance levels from lifecycle evidence", () => {
    const mounts: RoomMount[] = [
      {
        instanceId: "inst-1",
        server: "http://localhost:3001/mcp",
        session: { capabilities: {}, extensions: {}, transport: "streamable-http" },
        visible: true,
        container: { x: 0, y: 0, w: 6, h: 4 },
        tools: [],
      },
    ];
    const evidence: RoomEvidence[] = [
      {
        evidenceId: "ev-1-1",
        revision: 1,
        timestamp: "2026-03-08T00:00:00.000Z",
        source: "host",
        event: "bridge_connected",
        instanceId: "inst-1",
      },
      {
        evidenceId: "ev-2-2",
        revision: 2,
        timestamp: "2026-03-08T00:00:01.000Z",
        source: "host",
        event: "resource_delivered",
        instanceId: "inst-1",
      },
      {
        evidenceId: "ev-3-3",
        revision: 3,
        timestamp: "2026-03-08T00:00:02.000Z",
        source: "host",
        event: "app_initialized",
        instanceId: "inst-1",
      },
    ];

    const assurance = buildRoomAssurance(mounts, evidence);

    expect(assurance.instances).toHaveLength(1);
    expect(assurance.instances[0].level).toBe("ui_app_initialized");
    expect(assurance.instances[0].proven).toContain(
      "App signaled initialization through protocol callback.",
    );
    expect(assurance.instances[0].unknown).toEqual([]);
  });
});
