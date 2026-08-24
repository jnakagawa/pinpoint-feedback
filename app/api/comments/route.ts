import { getCommentsDb, type StoredComment } from "../../../db/comments";
import { PageAccessError, requirePageAccess } from "../../../db/page-access";
import { requireZeroUser, ZeroAuthError } from "../../zero-auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { ...corsHeaders, ...init?.headers } });
}

function isFinitePoint(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function cleanPageUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ZeroAuthError) return json({ error: error.message }, { status: 401 });
  if (error instanceof PageAccessError) return json({ error: error.message }, { status: error.status });
  return json({ error: error instanceof Error ? error.message : fallback }, { status: 500 });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const zeroUser = await requireZeroUser(request);
    const pageUrl = cleanPageUrl(new URL(request.url).searchParams.get("url"));
    if (!pageUrl) return json({ error: "A valid page URL is required" }, { status: 400 });

    const db = await getCommentsDb();
    await requirePageAccess(db, zeroUser, pageUrl);
    const result = await db.prepare(`SELECT id, author, body, page_url AS pageUrl,
      page_title AS pageTitle, zero_user_id AS zeroUserId, x, y, status,
      created_at AS createdAt FROM comments WHERE page_url = ?
      ORDER BY datetime(created_at) ASC, id ASC`)
      .bind(pageUrl)
      .all<StoredComment>();
    return json({ comments: result.results });
  } catch (error) {
    return errorResponse(error, "Unable to load comments");
  }
}

export async function POST(request: Request) {
  try {
    const zeroUser = await requireZeroUser(request);
    const payload = (await request.json()) as Partial<StoredComment>;
    const pageUrl = cleanPageUrl(payload.pageUrl);
    const pageTitle = payload.pageTitle?.trim().slice(0, 200) || "Untitled page";
    const author = payload.author?.trim().slice(0, 60) || "Zero reviewer";
    const body = payload.body?.trim().slice(0, 800) || "";
    if (!pageUrl) return json({ error: "A valid page URL is required" }, { status: 400 });
    if (!body) return json({ error: "Feedback is required" }, { status: 400 });
    if (!isFinitePoint(payload.x) || !isFinitePoint(payload.y)) {
      return json({ error: "A valid page position is required" }, { status: 400 });
    }

    const db = await getCommentsDb();
    await requirePageAccess(db, zeroUser, pageUrl);
    const result = await db.prepare(`INSERT INTO comments
      (author, body, page_url, page_title, zero_user_id, x, y, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`)
      .bind(author, body, pageUrl, pageTitle, zeroUser.id, payload.x, payload.y)
      .run();
    const comment = await db.prepare(`SELECT id, author, body, page_url AS pageUrl,
      page_title AS pageTitle, zero_user_id AS zeroUserId, x, y, status,
      created_at AS createdAt FROM comments WHERE id = ?`)
      .bind(result.meta.last_row_id)
      .first<StoredComment>();
    return json({ comment }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to save feedback");
  }
}

export async function PATCH(request: Request) {
  try {
    const zeroUser = await requireZeroUser(request);
    const payload = (await request.json()) as { id?: number; status?: string; pageUrl?: string };
    const pageUrl = cleanPageUrl(payload.pageUrl);
    if (!Number.isInteger(payload.id) || !["open", "resolved"].includes(payload.status || "") || !pageUrl) {
      return json({ error: "A valid comment, page URL, and status are required" }, { status: 400 });
    }
    const db = await getCommentsDb();
    await requirePageAccess(db, zeroUser, pageUrl);
    await db.prepare("UPDATE comments SET status = ? WHERE id = ? AND page_url = ?")
      .bind(payload.status, payload.id, pageUrl)
      .run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Unable to update feedback");
  }
}
