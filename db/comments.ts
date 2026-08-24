import { env } from "cloudflare:workers";

export type StoredComment = {
  id: number;
  author: string;
  body: string;
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
      x REAL NOT NULL,
      y REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_comments_status_created_at ON comments(status, created_at)"),
  ]);

  const count = await db.prepare("SELECT COUNT(*) AS total FROM comments").first<{ total: number }>();
  if (!count?.total) {
    await db.batch([
      db.prepare("INSERT INTO comments (author, body, x, y, status, created_at) VALUES (?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)")
        .bind("Alex Morgan", "Can we make this headline feel a little more specific to the studio?", 53, 38),
      db.prepare("INSERT INTO comments (author, body, x, y, status, created_at) VALUES (?, ?, ?, ?, 'open', datetime('now', '-4 minutes'))")
        .bind("Sam Lee", "This image treatment is great. Could we carry the soft orange into the footer?", 86, 74),
    ]);
  }

  return db;
}
