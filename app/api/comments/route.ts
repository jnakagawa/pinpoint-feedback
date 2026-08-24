import { getCommentsDb, type StoredComment } from "../../../db/comments";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { ...corsHeaders, ...init?.headers } });
}

function isFinitePoint(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const db = await getCommentsDb();
    const result = await db.prepare(`SELECT id, author, body, x, y, status, created_at AS createdAt
      FROM comments ORDER BY datetime(created_at) ASC, id ASC`).all<StoredComment>();
    return json({ comments: result.results });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to load comments" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<StoredComment>;
    const author = payload.author?.trim().slice(0, 60) || "Guest reviewer";
    const body = payload.body?.trim().slice(0, 800) || "";
    if (!body) return json({ error: "Feedback is required" }, { status: 400 });
    if (!isFinitePoint(payload.x) || !isFinitePoint(payload.y)) {
      return json({ error: "A valid page position is required" }, { status: 400 });
    }

    const db = await getCommentsDb();
    const result = await db.prepare("INSERT INTO comments (author, body, x, y, status) VALUES (?, ?, ?, ?, 'open')")
      .bind(author, body, payload.x, payload.y)
      .run();
    const comment = await db.prepare(`SELECT id, author, body, x, y, status, created_at AS createdAt
      FROM comments WHERE id = ?`).bind(result.meta.last_row_id).first<StoredComment>();
    return json({ comment }, { status: 201 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to save feedback" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { id?: number; status?: string };
    if (!Number.isInteger(payload.id) || !["open", "resolved"].includes(payload.status || "")) {
      return json({ error: "A valid comment and status are required" }, { status: 400 });
    }
    const db = await getCommentsDb();
    await db.prepare("UPDATE comments SET status = ? WHERE id = ?").bind(payload.status, payload.id).run();
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to update feedback" }, { status: 500 });
  }
}
