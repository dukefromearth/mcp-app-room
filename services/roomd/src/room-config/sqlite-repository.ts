import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import type { RoomConfigRepository } from "./repository";
import { ROOM_CONFIG_MIGRATIONS } from "./migrations";
import type {
  RoomConfigRecord,
  RoomConfigSchemaVersion,
  RoomConfigSpecV1,
  RoomConfigUpsertInput,
  RoomConfigVisibility,
} from "./types";

interface RoomConfigsTable {
  namespace: string;
  config_id: string;
  owner: string | null;
  visibility: RoomConfigVisibility;
  revision: number;
  schema_version: RoomConfigSchemaVersion;
  spec_json: string;
  created_at: string;
  updated_at: string;
}

interface RoomConfigRevisionsTable {
  namespace: string;
  config_id: string;
  revision: number;
  owner: string | null;
  visibility: RoomConfigVisibility;
  schema_version: RoomConfigSchemaVersion;
  spec_json: string;
  created_at: string;
}

interface RoomConfigDb {
  room_configs: RoomConfigsTable;
  room_config_revisions: RoomConfigRevisionsTable;
  room_config_migrations: {
    id: string;
    applied_at: string;
  };
}

interface SqliteRoomConfigRepositoryOptions {
  dbPath: string;
}

export class SqliteRoomConfigRepository implements RoomConfigRepository {
  private readonly db: Kysely<RoomConfigDb>;

  constructor(options: SqliteRoomConfigRepositoryOptions) {
    const filePath = resolve(options.dbPath);
    mkdirSync(dirname(filePath), { recursive: true });
    const sqlite = new Database(filePath);
    sqlite.pragma("journal_mode = WAL");
    this.db = new Kysely<RoomConfigDb>({
      dialect: new SqliteDialect({ database: sqlite }),
    });
  }

  async initialize(): Promise<void> {
    await sql`
      CREATE TABLE IF NOT EXISTS room_config_migrations (
        id TEXT NOT NULL PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `.execute(this.db);

    const appliedRows = await this.db
      .selectFrom("room_config_migrations")
      .select(["id"])
      .execute();
    const appliedIds = new Set(appliedRows.map((row) => row.id));

    for (const migration of ROOM_CONFIG_MIGRATIONS) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      await this.db.transaction().execute(async (trx) => {
        for (const statement of migration.statements) {
          await sql.raw(statement).execute(trx);
        }
        await trx
          .insertInto("room_config_migrations")
          .values({
            id: migration.id,
            applied_at: new Date().toISOString(),
          })
          .execute();
      });
    }
  }

  async list(namespace: string): Promise<RoomConfigRecord[]> {
    const rows = await this.db
      .selectFrom("room_configs")
      .selectAll()
      .where("namespace", "=", namespace)
      .orderBy("updated_at", "desc")
      .execute();

    return rows.map((row) => this.mapRowToRecord(row));
  }

  async get(namespace: string, configId: string): Promise<RoomConfigRecord | null> {
    const row = await this.db
      .selectFrom("room_configs")
      .selectAll()
      .where("namespace", "=", namespace)
      .where("config_id", "=", configId)
      .executeTakeFirst();

    return row ? this.mapRowToRecord(row) : null;
  }

  async upsert(input: RoomConfigUpsertInput): Promise<RoomConfigRecord> {
    return this.db.transaction().execute(async (trx) => {
      const now = new Date().toISOString();
      const existing = await trx
        .selectFrom("room_configs")
        .selectAll()
        .where("namespace", "=", input.namespace)
        .where("config_id", "=", input.configId)
        .executeTakeFirst();

      const revision = (existing?.revision ?? 0) + 1;
      const createdAt = existing?.created_at ?? now;
      const owner = input.owner ?? existing?.owner ?? null;
      const visibility = input.visibility;
      const schemaVersion = input.spec.schemaVersion;
      const specJson = JSON.stringify(input.spec);

      if (existing) {
        await trx
          .updateTable("room_configs")
          .set({
            owner,
            visibility,
            revision,
            schema_version: schemaVersion,
            spec_json: specJson,
            updated_at: now,
          })
          .where("namespace", "=", input.namespace)
          .where("config_id", "=", input.configId)
          .execute();
      } else {
        await trx
          .insertInto("room_configs")
          .values({
            namespace: input.namespace,
            config_id: input.configId,
            owner,
            visibility,
            revision,
            schema_version: schemaVersion,
            spec_json: specJson,
            created_at: createdAt,
            updated_at: now,
          })
          .execute();
      }

      await trx
        .insertInto("room_config_revisions")
        .values({
          namespace: input.namespace,
          config_id: input.configId,
          revision,
          owner,
          visibility,
          schema_version: schemaVersion,
          spec_json: specJson,
          created_at: now,
        })
        .execute();

      const saved = await trx
        .selectFrom("room_configs")
        .selectAll()
        .where("namespace", "=", input.namespace)
        .where("config_id", "=", input.configId)
        .executeTakeFirstOrThrow();

      return this.mapRowToRecord(saved);
    });
  }

  private mapRowToRecord(row: RoomConfigsTable): RoomConfigRecord {
    return {
      namespace: row.namespace,
      configId: row.config_id,
      ...(row.owner ? { owner: row.owner } : {}),
      visibility: row.visibility,
      revision: row.revision,
      schemaVersion: row.schema_version,
      spec: JSON.parse(row.spec_json) as RoomConfigSpecV1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createSqliteRoomConfigRepository(
  dbPath: string,
): SqliteRoomConfigRepository {
  return new SqliteRoomConfigRepository({ dbPath });
}
