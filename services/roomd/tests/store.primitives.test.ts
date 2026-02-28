import { describe, expect, it } from "vitest";
import { commandEnvelope, newStore } from "./store.fixtures";

async function mountInstance(store: ReturnType<typeof newStore>): Promise<void> {
  store.createRoom("demo");
  await store.applyCommand(
    "demo",
    commandEnvelope("cmd-mount", {
      type: "mount",
      instanceId: "inst-1",
      server: "http://localhost:3001/mcp",
      container: { x: 0, y: 0, w: 6, h: 4 },
    }),
  );
}

describe("RoomStore core primitive parity", () => {
  it("supports prompts/get passthrough", async () => {
    const store = newStore({
      promptResult: Promise.resolve({
        description: "Prompt result",
        messages: [{ role: "user", content: { type: "text", text: "hello" } }],
      }),
    });
    await mountInstance(store);

    const result = await store.getInstancePrompt("demo", "inst-1", {
      name: "debug-prompt",
      arguments: { topic: "mcp" },
    });

    expect(result).toEqual({
      description: "Prompt result",
      messages: [{ role: "user", content: { type: "text", text: "hello" } }],
    });
  });

  it("returns UNSUPPORTED_CAPABILITY for prompts/get when prompts capability is missing", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
          resources: {},
          completions: {},
        },
      },
    });
    await mountInstance(store);

    await expect(
      store.getInstancePrompt("demo", "inst-1", { name: "debug-prompt" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("supports completion/complete passthrough", async () => {
    const store = newStore({
      completeResult: Promise.resolve({
        completion: {
          values: ["hello", "hello world"],
          hasMore: false,
        },
      }),
    });
    await mountInstance(store);

    const result = await store.completeInstance("demo", "inst-1", {
      ref: { type: "ref/prompt", name: "debug-prompt" },
      argument: { name: "query", value: "hel" },
    });

    expect(result).toEqual({
      completion: {
        values: ["hello", "hello world"],
        hasMore: false,
      },
    });
  });

  it("returns UNSUPPORTED_CAPABILITY for completion/complete when completions capability is missing", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    });
    await mountInstance(store);

    await expect(
      store.completeInstance("demo", "inst-1", {
        ref: { type: "ref/prompt", name: "debug-prompt" },
        argument: { name: "query", value: "hel" },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("supports resources/subscribe passthrough", async () => {
    const store = newStore({
      subscribeResult: Promise.resolve({ ok: true }),
    });
    await mountInstance(store);

    const result = await store.subscribeInstanceResource("demo", "inst-1", {
      uri: "file://notes.md",
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns UNSUPPORTED_CAPABILITY for resources/subscribe when resources capability is missing", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
          prompts: {},
          completions: {},
        },
      },
    });
    await mountInstance(store);

    await expect(
      store.subscribeInstanceResource("demo", "inst-1", { uri: "file://notes.md" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("supports resources/unsubscribe passthrough", async () => {
    const store = newStore({
      unsubscribeResult: Promise.resolve({ ok: true }),
    });
    await mountInstance(store);

    const result = await store.unsubscribeInstanceResource("demo", "inst-1", {
      uri: "file://notes.md",
    });

    expect(result).toEqual({ ok: true });
  });

  it("returns UNSUPPORTED_CAPABILITY for resources/unsubscribe when resources capability is missing", async () => {
    const store = newStore({
      negotiatedSession: {
        capabilities: {
          tools: {},
          prompts: {},
          completions: {},
        },
      },
    });
    await mountInstance(store);

    await expect(
      store.unsubscribeInstanceResource("demo", "inst-1", { uri: "file://notes.md" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "UNSUPPORTED_CAPABILITY",
    });
  });
});
