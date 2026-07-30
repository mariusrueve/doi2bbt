import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    clientHash: text("client_hash").notNull(),
    windowStart: integer("window_start").notNull(),
    count: integer("count").notNull().default(1),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.clientHash, table.windowStart] }),
    index("rate_limits_expires_at_idx").on(table.expiresAt),
  ],
);
