import { describe, expect, it } from "vitest";
import { computeLayoutUpdate } from "../src/store/layout";

describe("store/layout seam", () => {
  it("rejects empty operation lists", () => {
    try {
      computeLayoutUpdate({
        adapterName: "grid12",
        ops: [],
        order: ["inst-1"],
        containers: new Map([
          ["inst-1", { x: 0, y: 0, w: 6, h: 4 }],
        ]),
      });
      throw new Error("Expected layout empty-op error");
    } catch (error) {
      expect(error).toMatchObject({
        statusCode: 400,
        code: "INVALID_COMMAND",
        message: "Layout command must include at least one operation",
      });
    }
  });

  it("keeps changed=false for no-op set operations", () => {
    const result = computeLayoutUpdate({
      adapterName: "grid12",
      ops: [
        {
          op: "set",
          instanceId: "inst-1",
          container: { x: 0, y: 0, w: 6, h: 4 },
        },
      ],
      order: ["inst-1", "inst-2"],
      containers: new Map([
        ["inst-1", { x: 0, y: 0, w: 6, h: 4 }],
        ["inst-2", { x: 6, y: 0, w: 6, h: 4 }],
      ]),
    });

    expect(result.changed).toBe(false);
    expect(result.nextOrder).toEqual(["inst-1", "inst-2"]);
    expect(result.nextContainers.get("inst-1")).toEqual({ x: 0, y: 0, w: 6, h: 4 });
  });

  it("supports deterministic order updates for bring-to-front", () => {
    const result = computeLayoutUpdate({
      adapterName: "grid12",
      ops: [{ op: "bring-to-front", instanceId: "inst-1" }],
      order: ["inst-1", "inst-2"],
      containers: new Map([
        ["inst-1", { x: 0, y: 0, w: 6, h: 4 }],
        ["inst-2", { x: 6, y: 0, w: 6, h: 4 }],
      ]),
    });

    expect(result.changed).toBe(true);
    expect(result.nextOrder).toEqual(["inst-2", "inst-1"]);
  });
});
