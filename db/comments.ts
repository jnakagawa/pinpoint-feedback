import { env } from "cloudflare:workers";

export type StoredComment = {
  id: number;
  author: string;
  body: string;
  pageUrl: string;
  pageTitle: string;
  zeroUserId: string;
  x: number;
  y: number;
  status: "open" | "resolved";
  createdAt: string;
};

export async function getCommentsDb() {
  const db = env.DB;
  if (!db) throw new Error("The comments database is unavailable.");

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      page_url TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      zero_user_id TEXT NOT NULL DEFAULT '',
      x REAL NOT NULL,
      y REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS page_access (
      page_url TEXT PRIMARY KEY,
      allowed_domain TEXT NOT NULL,
      owner_zero_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);

  const tableInfo = await db.prepare("PRAGMA table_info(comments)").all<{ name: string }>();
  const columnNames = new Set(tableInfo.results.map((column) => column.name));
  const upgrades = [];
  if (!columnNames.has("page_url")) upgrades.push(db.prepare("ALTER TABLE comments ADD COLUMN page_url TEXT NOT NULL DEFAULT ''"));
  if (!columnNames.has("page_title")) upgrades.push(db.prepare("ALTER TABLE comments ADD COLUMN page_title TEXT NOT NULL DEFAULT ''"));
  if (!columnNames.has("zero_user_id")) upgrades.push(db.prepare("ALTER TABLE comments ADD COLUMN zero_user_id TEXT NOT NULL DEFAULT ''"));
  if (upgrades.length) await db.batch(upgrades);

  await db.prepare("CREATE INDEX IF NOT EXISTS idx_comments_page_status_created_at ON comments(page_url, status, created_at)").run();

  const count = await db.prepare("SELECT COUNT(*) AS total FROM comments").first<{ total: number }>();
  if (!count?.total) {
    await db.batch([
      db.prepare("INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)")
        .bind("Alex Morgan", "Can we make this headline feel a little more specific to the studio?", "https://kanso.studio/", "Kanso Studio", "seed", 53, 38),
      db.prepare("INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', datetime('now', '-4 minutes'))")
        .bind("Sam Lee", "This image treatment is great. Could we carry the soft orange into the footer?", "https://kanso.studio/", "Kanso Studio", "seed", 86, 74),
    ]);
  }

  return db;
}
