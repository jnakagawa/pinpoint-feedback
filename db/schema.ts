import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_comments_status_created_at").on(table.status, table.createdAt)],
);
