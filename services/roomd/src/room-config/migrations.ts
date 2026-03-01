export interface RoomConfigMigration {
  id: string;
  statements: string[];
}

export const ROOM_CONFIG_MIGRATIONS: RoomConfigMigration[] = [
  {
    id: "2026-03-01-001_create_room_configs",
    statements: [
      `
      CREATE TABLE IF NOT EXISTS room_configs (
        namespace TEXT NOT NULL,
        config_id TEXT NOT NULL,
        owner TEXT,
        visibility TEXT NOT NULL,
        revision INTEGER NOT NULL,
        schema_version TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, config_id)
      )
      `,
      `
      CREATE TABLE IF NOT EXISTS room_config_revisions (
        namespace TEXT NOT NULL,
        config_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        owner TEXT,
        visibility TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, config_id, revision)
      )
      `,
    ],
  },
];
