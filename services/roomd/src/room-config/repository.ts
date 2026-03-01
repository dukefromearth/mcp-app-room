import type {
  RoomConfigRecord,
  RoomConfigUpsertInput,
} from "./types";

export interface RoomConfigRepository {
  list(namespace: string): Promise<RoomConfigRecord[]>;
  get(namespace: string, configId: string): Promise<RoomConfigRecord | null>;
  upsert(input: RoomConfigUpsertInput): Promise<RoomConfigRecord>;
}
