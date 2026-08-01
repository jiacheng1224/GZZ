import type { AuthoritativeRoom } from "../packages/game-core/src";

export type StoredRoom = {
  readonly room: AuthoritativeRoom;
  readonly revision: number;
};

export interface RoomRepository {
  create(room: AuthoritativeRoom): Promise<StoredRoom>;
  findById(roomId: string): Promise<StoredRoom | null>;
  findByInviteCode(inviteCode: string): Promise<StoredRoom | null>;
  save(room: AuthoritativeRoom, expectedRevision: number): Promise<StoredRoom>;
  deleteExpired(now: number, limit: number): Promise<number>;
}

export class RoomRepositoryConflictError extends Error {
  constructor(message = "Room was changed by another request.") {
    super(message);
    this.name = "RoomRepositoryConflictError";
  }
}

const schemaInitialization = new WeakMap<object, Promise<void>>();

export function ensureRoomRepositorySchema(
  database: D1Database,
): Promise<void> {
  const existing = schemaInitialization.get(database);
  if (existing) return existing;
  const initialization = database
    .batch([
      database.prepare(
        `CREATE TABLE IF NOT EXISTS game_rooms (
          room_id text PRIMARY KEY NOT NULL,
          invite_code text NOT NULL UNIQUE,
          state_json text NOT NULL,
          status text NOT NULL,
          revision integer DEFAULT 1 NOT NULL,
          updated_at integer NOT NULL,
          expires_at integer NOT NULL
        )`,
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS game_rooms_status_idx ON game_rooms (status)",
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS game_rooms_expires_at_idx ON game_rooms (expires_at)",
      ),
      database.prepare(
        `CREATE TABLE IF NOT EXISTS room_rate_limits (
          bucket_key text PRIMARY KEY NOT NULL,
          request_count integer DEFAULT 1 NOT NULL,
          expires_at integer NOT NULL
        )`,
      ),
      database.prepare(
        "CREATE INDEX IF NOT EXISTS room_rate_limits_expires_at_idx ON room_rate_limits (expires_at)",
      ),
    ])
    .then(() => undefined);
  schemaInitialization.set(database, initialization);
  return initialization;
}

function decodeRoom(value: string, expectedRoomId: string): AuthoritativeRoom {
  const room = JSON.parse(value) as AuthoritativeRoom;
  if (
    !room ||
    room.schemaVersion !== 1 ||
    room.roomId !== expectedRoomId ||
    typeof room.inviteCode !== "string"
  )
    throw new Error("Stored room payload is invalid.");
  return room;
}

type RoomRow = {
  room_id: string;
  state_json: string;
  revision: number;
};

export class D1RoomRepository implements RoomRepository {
  constructor(private readonly database: D1Database) {}

  async create(room: AuthoritativeRoom): Promise<StoredRoom> {
    try {
      await this.database
        .prepare(
          `INSERT INTO game_rooms
            (room_id, invite_code, state_json, status, revision, updated_at, expires_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          room.roomId,
          room.inviteCode,
          JSON.stringify(room),
          room.status,
          room.updatedAt,
          room.expiresAt,
        )
        .run();
    } catch (error) {
      if (String(error).includes("UNIQUE"))
        throw new RoomRepositoryConflictError(
          "Room ID or invite code already exists.",
        );
      throw error;
    }
    return { room: structuredClone(room), revision: 1 };
  }

  async findById(roomId: string): Promise<StoredRoom | null> {
    const row = await this.database
      .prepare(
        "SELECT room_id, state_json, revision FROM game_rooms WHERE room_id = ? LIMIT 1",
      )
      .bind(roomId)
      .first<RoomRow>();
    return row
      ? {
          room: decodeRoom(row.state_json, row.room_id),
          revision: row.revision,
        }
      : null;
  }

  async findByInviteCode(inviteCode: string): Promise<StoredRoom | null> {
    const row = await this.database
      .prepare(
        "SELECT room_id, state_json, revision FROM game_rooms WHERE invite_code = ? LIMIT 1",
      )
      .bind(inviteCode)
      .first<RoomRow>();
    return row
      ? {
          room: decodeRoom(row.state_json, row.room_id),
          revision: row.revision,
        }
      : null;
  }

  async save(
    room: AuthoritativeRoom,
    expectedRevision: number,
  ): Promise<StoredRoom> {
    const result = await this.database
      .prepare(
        `UPDATE game_rooms
         SET state_json = ?, status = ?, revision = revision + 1,
             updated_at = ?, expires_at = ?
         WHERE room_id = ? AND revision = ?`,
      )
      .bind(
        JSON.stringify(room),
        room.status,
        room.updatedAt,
        room.expiresAt,
        room.roomId,
        expectedRevision,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1)
      throw new RoomRepositoryConflictError();
    return {
      room: structuredClone(room),
      revision: expectedRevision + 1,
    };
  }

  async deleteExpired(now: number, limit: number): Promise<number> {
    const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
    const result = await this.database
      .prepare(
        `DELETE FROM game_rooms
         WHERE room_id IN (
           SELECT room_id FROM game_rooms
           WHERE expires_at <= ? OR status = 'expired'
           ORDER BY expires_at ASC
           LIMIT ?
         )`,
      )
      .bind(now, safeLimit)
      .run();
    return result.meta.changes ?? 0;
  }
}

export class MemoryRoomRepository implements RoomRepository {
  private readonly records = new Map<string, StoredRoom>();

  async create(room: AuthoritativeRoom): Promise<StoredRoom> {
    if (
      this.records.has(room.roomId) ||
      [...this.records.values()].some(
        (record) => record.room.inviteCode === room.inviteCode,
      )
    )
      throw new RoomRepositoryConflictError(
        "Room ID or invite code already exists.",
      );
    const stored = { room: structuredClone(room), revision: 1 };
    this.records.set(room.roomId, stored);
    return structuredClone(stored);
  }

  async findById(roomId: string): Promise<StoredRoom | null> {
    const stored = this.records.get(roomId);
    return stored ? structuredClone(stored) : null;
  }

  async findByInviteCode(inviteCode: string): Promise<StoredRoom | null> {
    const stored = [...this.records.values()].find(
      (record) => record.room.inviteCode === inviteCode,
    );
    return stored ? structuredClone(stored) : null;
  }

  async save(
    room: AuthoritativeRoom,
    expectedRevision: number,
  ): Promise<StoredRoom> {
    const current = this.records.get(room.roomId);
    if (!current || current.revision !== expectedRevision)
      throw new RoomRepositoryConflictError();
    const stored = {
      room: structuredClone(room),
      revision: expectedRevision + 1,
    };
    this.records.set(room.roomId, stored);
    return structuredClone(stored);
  }

  async deleteExpired(now: number, limit: number): Promise<number> {
    let deleted = 0;
    for (const [roomId, stored] of this.records) {
      if (deleted >= limit) break;
      if (stored.room.expiresAt <= now || stored.room.status === "expired") {
        this.records.delete(roomId);
        deleted += 1;
      }
    }
    return deleted;
  }
}
