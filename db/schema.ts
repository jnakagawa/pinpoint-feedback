import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    pageUrl: text("page_url").notNull().default(""),
    pageTitle: text("page_title").notNull().default(""),
    zeroUserId: text("zero_user_id").notNull().default(""),
    x: real("x").notNull(),
    y: real("y").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("idx_comments_page_status_created_at").on(table.pageUrl, table.status, table.createdAt),
  ],
);

export const pageAccess = sqliteTable("page_access", {
  pageUrl: text("page_url").primaryKey(),
  allowedDomain: text("allowed_domain").notNull(),
  ownerZeroUserId: text("owner_zero_user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
