import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteRoomConfigRepository } from "../src/room-config/sqlite-repository";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createRepository() {
  const dir = mkdtempSync(join(tmpdir(), "room-config-repo-"));
  tempDirs.push(dir);
  const repository = createSqliteRoomConfigRepository(join(dir, "room-configs.sqlite"));
  return repository;
}

describe("SqliteRoomConfigRepository", () => {
  it("persists and retrieves room configs with revision history", async () => {
    const repository = createRepository();
    await repository.initialize();

    const first = await repository.upsert({
      namespace: "default",
      configId: "audio-workbench",
      visibility: "private",
      spec: {
        schemaVersion: "room-config.v1",
        title: "Audio Workbench",
        instances: [
          {
            instanceId: "sampler",
            server: "http://localhost:3001/mcp",
            container: { x: 0, y: 0, w: 6, h: 4 },
          },
        ],
      },
    });
    const second = await repository.upsert({
      namespace: "default",
      configId: "audio-workbench",
      visibility: "shared",
      spec: {
        schemaVersion: "room-config.v1",
        title: "Audio Workbench v2",
        instances: [
          {
            instanceId: "sampler",
            server: "http://localhost:3001/mcp",
            container: { x: 0, y: 0, w: 6, h: 4 },
          },
          {
            instanceId: "compressor",
            server: "http://localhost:3002/mcp",
            container: { x: 6, y: 0, w: 6, h: 4 },
          },
        ],
      },
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(second.visibility).toBe("shared");

    const loaded = await repository.get("default", "audio-workbench");
    expect(loaded?.revision).toBe(2);
    expect(loaded?.spec.instances).toHaveLength(2);

    const list = await repository.list("default");
    expect(list).toHaveLength(1);
    expect(list[0]?.configId).toBe("audio-workbench");
  });

  it("returns null for unknown room configuration", async () => {
    const repository = createRepository();
    await repository.initialize();

    await expect(repository.get("default", "missing")).resolves.toBeNull();
  });
});
