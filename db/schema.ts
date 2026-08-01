import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameRooms = sqliteTable(
  "game_rooms",
  {
    roomId: text("room_id").primaryKey(),
    inviteCode: text("invite_code").notNull().unique(),
    stateJson: text("state_json").notNull(),
    status: text("status").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("game_rooms_status_idx").on(table.status),
    index("game_rooms_expires_at_idx").on(table.expiresAt),
  ],
);

export const roomRateLimits = sqliteTable(
  "room_rate_limits",
  {
    bucketKey: text("bucket_key").primaryKey(),
    requestCount: integer("request_count").notNull().default(1),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("room_rate_limits_expires_at_idx").on(table.expiresAt)],
);
