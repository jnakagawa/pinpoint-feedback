import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const PORT = Number(process.env.PORT) || 3000;
const ZERO_API = "https://api.zero.xyz";
const ZERO_SDK_VERSION = "1.33.0";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

class HttpError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Page-Title, X-Page-Width, X-Page-Height, X-Viewport-Width, X-Viewport-Height, X-Scroll-X, X-Scroll-Y, X-Device-Pixel-Ratio",
  "Access-Control-Expose-Headers": "X-Page-Title, X-Page-Width, X-Page-Height, X-Viewport-Width, X-Viewport-Height, X-Scroll-X, X-Scroll-Y, X-Device-Pixel-Ratio, X-Captured-At",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...corsHeaders, "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function json(response, status, data) {
  send(response, status, JSON.stringify(data), { "Content-Type": "application/json; charset=utf-8" });
}

function cleanPageUrl(value) {
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

function cleanDomain(value) {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ? domain : null;
}

function emailDomain(email) {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? cleanDomain(email.slice(at + 1)) : null;
}

function finitePoint(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function finiteHeader(request, name, fallback = 0) {
  const value = Number(request.headers[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function decodedTitle(request) {
  const value = request.headers["x-page-title"] || "";
  try { return decodeURIComponent(value).trim().slice(0, 200) || "Untitled page"; }
  catch { return value.trim().slice(0, 200) || "Untitled page"; }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError("Request body is too large", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request, MAX_JSON_BYTES);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new HttpError("A valid JSON body is required", 400); }
}

async function getZeroUser(request, required = false) {
  const authorization = request.headers.authorization;
  if (!authorization) {
    if (required) throw new HttpError("Sign in with Zero to continue.", 401);
    return null;
  }
  if (!authorization.startsWith("Bearer ")) throw new HttpError("Your Zero authorization is invalid.", 401);
  const profileResponse = await fetch(`${ZERO_API}/v1/users/me/profile`, {
    headers: { authorization, "x-zero-sdk-version": ZERO_SDK_VERSION },
  });
  if (!profileResponse.ok) throw new HttpError("Your Zero session is invalid or expired.", 401);
  const profile = await profileResponse.json();
  if (!profile.user?.id) throw new HttpError("Zero did not return a valid identity.", 401);
  return { id: profile.user.id, email: profile.user.email || null, walletAddress: profile.walletAddress || null };
}

async function pagePolicy(pageUrl) {
  const result = await pool.query("SELECT page_url, allowed_domain, owner_zero_user_id FROM page_access WHERE page_url = $1", [pageUrl]);
  return result.rows[0] || null;
}

function describeAccess(policy, user) {
  const domain = emailDomain(user?.email || null);
  return {
    allowedDomain: policy?.allowed_domain || null,
    emailDomain: domain,
    hasAccess: !policy || domain === policy.allowed_domain,
    canManage: policy ? policy.owner_zero_user_id === user?.id : Boolean(domain),
  };
}

async function requirePageAccess(pageUrl, user) {
  const policy = await pagePolicy(pageUrl);
  const access = describeAccess(policy, user);
  if (policy && !user) throw new HttpError(`Sign in with a Zero account using an @${policy.allowed_domain} email.`, 401);
  if (!access.hasAccess) throw new HttpError(`This page is restricted to Zero accounts with an @${policy.allowed_domain} email.`, 403);
  return access;
}

function commentRow(row) {
  return {
    id: row.id,
    author: row.author,
    body: row.body,
    pageUrl: row.page_url,
    pageTitle: row.page_title,
    x: Number(row.x),
    y: Number(row.y),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function handleComments(request, response, url) {
  if (request.method === "GET") {
    const user = await getZeroUser(request);
    const pageUrl = cleanPageUrl(url.searchParams.get("url"));
    if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
    await requirePageAccess(pageUrl, user);
    const result = await pool.query("SELECT * FROM comments WHERE page_url = $1 ORDER BY created_at ASC, id ASC", [pageUrl]);
    return json(response, 200, { comments: result.rows.map(commentRow) });
  }

  if (request.method === "POST") {
    const user = await getZeroUser(request);
    const payload = await readJson(request);
    const pageUrl = cleanPageUrl(payload.pageUrl);
    const pageTitle = String(payload.pageTitle || "Untitled page").trim().slice(0, 200);
    const author = String(payload.author || "Zero reviewer").trim().slice(0, 60);
    const body = String(payload.body || "").trim().slice(0, 800);
    if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
    if (!body) throw new HttpError("Feedback is required", 400);
    if (!finitePoint(payload.x) || !finitePoint(payload.y)) throw new HttpError("A valid page position is required", 400);
    await requirePageAccess(pageUrl, user);
    const result = await pool.query(`INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'open') RETURNING *`,
      [author, body, pageUrl, pageTitle, user?.id || "guest", payload.x, payload.y]);
    return json(response, 201, { comment: commentRow(result.rows[0]) });
  }

  if (request.method === "PATCH") {
    const user = await getZeroUser(request);
    const payload = await readJson(request);
    const pageUrl = cleanPageUrl(payload.pageUrl);
    if (!Number.isInteger(payload.id) || !["open", "resolved"].includes(payload.status) || !pageUrl) {
      throw new HttpError("A valid comment, page URL, and status are required", 400);
    }
    await requirePageAccess(pageUrl, user);
    await pool.query("UPDATE comments SET status = $1 WHERE id = $2 AND page_url = $3", [payload.status, payload.id, pageUrl]);
    return json(response, 200, { ok: true });
  }

  throw new HttpError("Method not allowed", 405);
}

async function handleAccess(request, response, url) {
  const user = await getZeroUser(request, true);
  if (request.method === "GET") {
    const pageUrl = cleanPageUrl(url.searchParams.get("url"));
    if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
    return json(response, 200, { access: describeAccess(await pagePolicy(pageUrl), user) });
  }
  if (request.method !== "PUT") throw new HttpError("Method not allowed", 405);
  const payload = await readJson(request);
  const pageUrl = cleanPageUrl(payload.pageUrl);
  if (!pageUrl || !("allowedDomain" in payload)) throw new HttpError("A valid page URL and email domain are required", 400);
  const policy = await pagePolicy(pageUrl);
  if (policy && policy.owner_zero_user_id !== user.id) throw new HttpError("Only the person who protected this page can change its domain restriction.", 403);
  if (payload.allowedDomain === null) {
    await pool.query("DELETE FROM page_access WHERE page_url = $1 AND owner_zero_user_id = $2", [pageUrl, user.id]);
    return json(response, 200, { access: describeAccess(null, user) });
  }
  const ownDomain = emailDomain(user.email);
  const allowedDomain = cleanDomain(payload.allowedDomain);
  if (!ownDomain) throw new HttpError("Your Zero account does not include a usable domain email.", 400);
  if (!allowedDomain) throw new HttpError("Enter a valid email domain, such as studio.com.", 400);
  if (allowedDomain !== ownDomain) throw new HttpError(`You can only protect a page with your own Zero email domain: @${ownDomain}.`, 403);
  await pool.query(`INSERT INTO page_access (page_url, allowed_domain, owner_zero_user_id) VALUES ($1, $2, $3)
    ON CONFLICT (page_url) DO UPDATE SET allowed_domain = EXCLUDED.allowed_domain, updated_at = CURRENT_TIMESTAMP`,
    [pageUrl, allowedDomain, user.id]);
  return json(response, 200, { access: describeAccess(await pagePolicy(pageUrl), user) });
}

async function handleSnapshot(request, response, url) {
  const pageUrl = cleanPageUrl(url.searchParams.get("url"));
  if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
  if (request.method === "GET") {
    const user = await getZeroUser(request);
    await requirePageAccess(pageUrl, user);
    const result = await pool.query("SELECT * FROM snapshots WHERE page_url = $1", [pageUrl]);
    const snapshot = result.rows[0];
    if (!snapshot) throw new HttpError("No page capture has been shared yet", 404);
    return send(response, 200, snapshot.image, {
      "Content-Type": snapshot.content_type,
      "Content-Length": String(snapshot.image.length),
      "X-Page-Title": encodeURIComponent(snapshot.page_title),
      "X-Page-Width": String(snapshot.page_width),
      "X-Page-Height": String(snapshot.page_height),
      "X-Viewport-Width": String(snapshot.viewport_width),
      "X-Viewport-Height": String(snapshot.viewport_height),
      "X-Scroll-X": String(snapshot.scroll_x),
      "X-Scroll-Y": String(snapshot.scroll_y),
      "X-Device-Pixel-Ratio": String(snapshot.device_pixel_ratio),
      "X-Captured-At": new Date(snapshot.captured_at).toISOString(),
    });
  }
  if (request.method !== "POST") throw new HttpError("Method not allowed", 405);
  const user = await getZeroUser(request, true);
  await requirePageAccess(pageUrl, user);
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
  if (!["image/jpeg", "image/png"].includes(contentType)) throw new HttpError("The page capture must be a JPEG or PNG image", 415);
  const image = await readBody(request, MAX_SNAPSHOT_BYTES);
  if (!image.length) throw new HttpError("The page capture is empty", 400);
  const values = [pageUrl, decodedTitle(request), contentType, image, finiteHeader(request, "x-page-width"), finiteHeader(request, "x-page-height"), finiteHeader(request, "x-viewport-width"), finiteHeader(request, "x-viewport-height"), finiteHeader(request, "x-scroll-x"), finiteHeader(request, "x-scroll-y"), finiteHeader(request, "x-device-pixel-ratio", 1)];
  await pool.query(`INSERT INTO snapshots (page_url, page_title, content_type, image, page_width, page_height, viewport_width, viewport_height, scroll_x, scroll_y, device_pixel_ratio, captured_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_TIMESTAMP)
    ON CONFLICT (page_url) DO UPDATE SET page_title=EXCLUDED.page_title, content_type=EXCLUDED.content_type, image=EXCLUDED.image, page_width=EXCLUDED.page_width, page_height=EXCLUDED.page_height, viewport_width=EXCLUDED.viewport_width, viewport_height=EXCLUDED.viewport_height, scroll_x=EXCLUDED.scroll_x, scroll_y=EXCLUDED.scroll_y, device_pixel_ratio=EXCLUDED.device_pixel_ratio, captured_at=CURRENT_TIMESTAMP`, values);
  return json(response, 201, { ok: true, capturedAt: new Date().toISOString() });
}

async function serveStatic(response, pathname) {
  const fileName = pathname === "/" || pathname === "/index.html" ? "index.html" : pathname === "/app.js" ? "app.js" : pathname === "/styles.css" ? "styles.css" : null;
  if (!fileName) throw new HttpError("Not found", 404);
  const contentTypes = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "styles.css": "text/css; charset=utf-8" };
  const body = await readFile(join(PUBLIC_DIR, fileName));
  return send(response, 200, body, { "Content-Type": contentTypes[fileName], "Cache-Control": fileName === "index.html" ? "no-store" : "public, max-age=60" });
}

async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY, author TEXT NOT NULL, body TEXT NOT NULL, page_url TEXT NOT NULL,
    page_title TEXT NOT NULL, zero_user_id TEXT NOT NULL, x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_comments_page_status_created_at ON comments(page_url, status, created_at)");
  await pool.query(`CREATE TABLE IF NOT EXISTS page_access (
    page_url TEXT PRIMARY KEY, allowed_domain TEXT NOT NULL, owner_zero_user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS snapshots (
    page_url TEXT PRIMARY KEY, page_title TEXT NOT NULL, content_type TEXT NOT NULL, image BYTEA NOT NULL,
    page_width DOUBLE PRECISION NOT NULL, page_height DOUBLE PRECISION NOT NULL,
    viewport_width DOUBLE PRECISION NOT NULL, viewport_height DOUBLE PRECISION NOT NULL,
    scroll_x DOUBLE PRECISION NOT NULL, scroll_y DOUBLE PRECISION NOT NULL,
    device_pixel_ratio DOUBLE PRECISION NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, status, created_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz
    WHERE NOT EXISTS (SELECT 1 FROM comments WHERE page_url=$3 AND author=$1 AND body=$2)`,
    ["j.a.nakagawa", "Lets get rid of this stat", "https://zeroclick.ai/trends", "AI Purchase Trends | ZeroClick", "legacy-import", 23.429242513211978, 73.53608715388107, "open", "2026-08-24T20:53:20Z"]);
}

await initDatabase();

createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(response, 204, "");
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") return json(response, 200, { ok: true, service: "pinpoint-zero" });
    if (url.pathname === "/api/comments") return await handleComments(request, response, url);
    if (url.pathname === "/api/access") return await handleAccess(request, response, url);
    if (url.pathname === "/api/snapshot") return await handleSnapshot(request, response, url);
    return await serveStatic(response, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    console.error(error);
    return json(response, status, { error: status === 500 ? "Pinpoint encountered an unexpected error" : error.message });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Pinpoint listening on ${PORT}`));

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
