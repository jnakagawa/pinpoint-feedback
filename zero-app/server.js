import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import pg from "pg";
import puppeteer from "puppeteer-core";

const { Pool } = pg;
const PORT = Number(process.env.PORT) || 3000;
const ZERO_API = "https://api.zero.xyz";
const ZERO_SDK_VERSION = "1.33.0";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 6 * 1024 * 1024;
const MAX_CAPTURE_HEIGHT = 18_000;
const MAX_CAPTURE_WIDTH = 3_840;
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "public");
const ARCHIVE_STYLE = `html{scroll-behavior:smooth}html.pinpoint-comment-mode,html.pinpoint-comment-mode body{cursor:crosshair!important}*{animation-play-state:paused!important}.pinpoint-canvas-fallback{min-height:180px;display:grid;place-items:center;padding:28px;border:1px solid rgba(120,120,120,.18);background:linear-gradient(135deg,rgba(120,120,120,.05),rgba(120,120,120,.12));color:inherit;text-align:center}.pinpoint-canvas-fallback span{max-width:560px;font:600 14px/1.5 Arial,sans-serif}#pinpoint-archive-pins{position:absolute;inset:0;z-index:2147483646;pointer-events:none}.pinpoint-archive-pin{position:absolute;width:30px;height:30px;display:grid;place-items:center;margin:-15px 0 0 -15px;padding:0;border:3px solid #fff;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:#6d5dfc;box-shadow:0 5px 16px rgba(73,56,205,.35);color:#fff;font:800 11px/1 Arial,sans-serif;pointer-events:auto;cursor:pointer}.pinpoint-archive-pin span{transform:rotate(45deg)}.pinpoint-archive-pin.selected{transform:rotate(-45deg) scale(1.18)}.pinpoint-archive-pin.resolved{opacity:.48;filter:grayscale(.35)}.pinpoint-archive-pin.locating{animation:pinpointArchivePulse .65s ease-in-out 2!important}@keyframes pinpointArchivePulse{50%{transform:rotate(-45deg) scale(1.55);filter:brightness(1.2)}}`;
const ARCHIVE_RUNTIME = String.raw`(() => {
  const channel = "pinpoint-archive-v1";
  let mode = "comment";
  let comments = [];
  let selectedId = null;
  const root = document.createElement("div");
  root.id = "pinpoint-archive-pins";
  document.body.append(root);
  const cleanText = (element) => String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const escapeSelector = (value) => globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => "\\" + character);
  const escapeAttribute = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const stableSelector = (element) => {
    if (!(element instanceof Element)) return "";
    if (element.id) {
      const selector = "#" + escapeSelector(element.id);
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
    }
    for (const name of ["data-testid", "data-test", "name", "aria-label"]) {
      const value = element.getAttribute(name);
      if (!value || value.length > 160) continue;
      const selector = element.localName + "[" + name + '=\"' + escapeAttribute(value) + '\"]';
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
    }
    const parts = [];
    let current = element;
    for (let depth = 0; current && current !== document.documentElement && depth < 7; depth += 1) {
      const tag = current.localName;
      if (!tag) break;
      const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.localName === tag) : [];
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : tag);
      const selector = parts.join(" > ");
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
      current = current.parentElement;
    }
    return parts.join(" > ");
  };
  const buildAnchor = (element, clientX, clientY) => {
    const rect = element.getBoundingClientRect();
    return {
      version: 1,
      selector: stableSelector(element),
      tag: element.localName || "",
      text: cleanText(element),
      offsetX: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
      offsetY: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
    };
  };
  const resolveAnchor = (anchor) => {
    if (!anchor) return null;
    let element = null;
    if (anchor.selector) {
      try { element = document.querySelector(anchor.selector); } catch { element = null; }
    }
    if (!element && anchor.text) {
      const selector = /^[a-z0-9-]+$/.test(anchor.tag || "") ? anchor.tag : "body *";
      const wanted = String(anchor.text).replace(/\s+/g, " ").trim();
      try { element = [...document.querySelectorAll(selector)].slice(0, 1500).find((candidate) => {
        const text = cleanText(candidate);
        return text === wanted || (wanted.length >= 24 && text.includes(wanted));
      }) || null; } catch { element = null; }
    }
    return element;
  };
  const dimensions = () => ({
    width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight),
  });
  const commentPoint = (comment) => {
    const element = resolveAnchor(comment.anchor);
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height) return { x: rect.left + scrollX + rect.width * (Number(comment.anchor.offsetX) || 0), y: rect.top + scrollY + rect.height * (Number(comment.anchor.offsetY) || 0) };
    }
    if (comment.positionAvailable === false) return null;
    const size = dimensions();
    return { x: (Number(comment.x) / 100) * size.width, y: (Number(comment.y) / 100) * size.height };
  };
  const render = () => {
    root.replaceChildren();
    comments.forEach((comment, index) => {
      const point = commentPoint(comment);
      if (!point) return;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "pinpoint-archive-pin" + (comment.status === "resolved" ? " resolved" : "") + (comment.id === selectedId ? " selected" : "");
      pin.dataset.commentId = String(comment.id);
      pin.style.left = point.x + "px";
      pin.style.top = point.y + "px";
      pin.setAttribute("aria-label", "Open comment " + (index + 1));
      const label = document.createElement("span");
      label.textContent = String(index + 1);
      pin.append(label);
      root.append(pin);
    });
  };
  const post = (type, payload = {}) => parent.postMessage({ channel, type, ...payload }, "*");
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.channel !== channel) return;
    if (event.data.type === "mode") {
      mode = event.data.mode === "navigate" ? "navigate" : "comment";
      document.documentElement.classList.toggle("pinpoint-comment-mode", mode === "comment");
    }
    if (event.data.type === "render") {
      comments = Array.isArray(event.data.comments) ? event.data.comments : [];
      selectedId = event.data.selectedId ?? null;
      render();
    }
    if (event.data.type === "locate") {
      selectedId = event.data.id;
      render();
      const pin = root.querySelector('[data-comment-id="' + escapeSelector(String(selectedId)) + '"]');
      pin?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      pin?.classList.add("locating");
      setTimeout(() => pin?.classList.remove("locating"), 1300);
    }
  });
  document.addEventListener("submit", (event) => event.preventDefault(), true);
  document.addEventListener("click", (event) => {
    const pin = event.target.closest?.(".pinpoint-archive-pin");
    if (pin) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return post("select", { id: Number(pin.dataset.commentId) });
    }
    const link = event.target.closest?.("a");
    if (link) event.preventDefault();
    if (mode !== "comment" || !(event.target instanceof Element)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const size = dimensions();
    post("draft", {
      x: Math.max(0, Math.min(100, ((event.clientX + scrollX) / Math.max(1, size.width)) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY + scrollY) / Math.max(1, size.height)) * 100)),
      viewX: Math.max(2, Math.min(98, (event.clientX / Math.max(1, innerWidth)) * 100)),
      viewY: Math.max(2, Math.min(98, (event.clientY / Math.max(1, innerHeight)) * 100)),
      anchor: buildAnchor(event.target, event.clientX, event.clientY),
    });
  }, true);
  addEventListener("resize", render, { passive: true });
  new ResizeObserver(() => render()).observe(document.documentElement);
  document.documentElement.classList.add("pinpoint-comment-mode");
  post("ready", { dimensions: dimensions() });
})();`;

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
  "Access-Control-Expose-Headers": "X-Page-Title, X-Page-Width, X-Page-Height, X-Viewport-Width, X-Viewport-Height, X-Scroll-X, X-Scroll-Y, X-Device-Pixel-Ratio, X-Captured-At, X-Capture-Id, X-Capture-Source",
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

function cleanCaptureId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null;
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

function cleanAnchor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const anchor = {
    version: 1,
    selector: String(value.selector || "").trim().slice(0, 900),
    tag: String(value.tag || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40),
    text: String(value.text || "").replace(/\s+/g, " ").trim().slice(0, 180),
    offsetX: Number(value.offsetX),
    offsetY: Number(value.offsetY),
  };
  if (!anchor.selector && !anchor.text) return null;
  if (!Number.isFinite(anchor.offsetX) || anchor.offsetX < 0 || anchor.offsetX > 1) anchor.offsetX = 0.5;
  if (!Number.isFinite(anchor.offsetY) || anchor.offsetY < 0 || anchor.offsetY > 1) anchor.offsetY = 0.5;
  return JSON.stringify(anchor).length <= 4096 ? anchor : null;
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

function commentRow(row, user = null) {
  return {
    id: Number(row.id), author: row.author, body: row.body, pageUrl: row.page_url, pageTitle: row.page_title,
    x: Number(row.display_x ?? row.x), y: Number(row.display_y ?? row.y), anchor: row.anchor_json || null,
    captureId: row.capture_id || null, captureMatched: Boolean(row.capture_matched),
    positionAvailable: row.position_available === undefined ? true : Boolean(row.position_available),
    status: row.status, createdAt: new Date(row.created_at).toISOString(),
    canEdit: Boolean(user && row.zero_user_id === user.id),
  };
}

async function handleComments(request, response, url) {
  if (request.method === "GET") {
    const user = await getZeroUser(request);
    const pageUrl = cleanPageUrl(url.searchParams.get("url"));
    const captureId = cleanCaptureId(url.searchParams.get("capture"));
    if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
    await requirePageAccess(pageUrl, user);
    if (captureId) {
      const result = await pool.query(`SELECT c.*, COALESCE(p.x, c.x) AS display_x, COALESCE(p.y, c.y) AS display_y,
        COALESCE(p.matched, FALSE) AS capture_matched,
        (c.capture_id IS NULL OR c.capture_id = $2 OR COALESCE(p.matched, FALSE)) AS position_available
        FROM comments c LEFT JOIN capture_comment_positions p ON p.comment_id = c.id AND p.capture_id = $2
        WHERE c.page_url = $1 ORDER BY c.created_at ASC, c.id ASC`, [pageUrl, captureId]);
      return json(response, 200, { captureId, comments: result.rows.map((row) => commentRow(row, user)) });
    }
    const result = await pool.query("SELECT *, TRUE AS position_available FROM comments WHERE page_url = $1 ORDER BY created_at ASC, id ASC", [pageUrl]);
    return json(response, 200, { comments: result.rows.map((row) => commentRow(row, user)) });
  }

  if (request.method === "POST") {
    const user = await getZeroUser(request);
    const payload = await readJson(request);
    const pageUrl = cleanPageUrl(payload.pageUrl);
    const pageTitle = String(payload.pageTitle || "Untitled page").trim().slice(0, 200);
    const author = String(payload.author || "Zero reviewer").trim().slice(0, 60);
    const body = String(payload.body || "").trim().slice(0, 800);
    const captureId = payload.captureId ? cleanCaptureId(payload.captureId) : null;
    const anchor = cleanAnchor(payload.anchor);
    if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
    if (!body) throw new HttpError("Feedback is required", 400);
    if (!finitePoint(payload.x) || !finitePoint(payload.y)) throw new HttpError("A valid page position is required", 400);
    if (payload.captureId && !captureId) throw new HttpError("A valid capture revision is required", 400);
    await requirePageAccess(pageUrl, user);
    if (captureId) {
      const capture = await pool.query("SELECT 1 FROM captures WHERE id = $1 AND page_url = $2", [captureId, pageUrl]);
      if (!capture.rowCount) throw new HttpError("That capture revision does not belong to this page", 400);
    }
    const result = await pool.query(`INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, anchor_json, capture_id, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open') RETURNING *`,
    [author, body, pageUrl, pageTitle, user?.id || "guest", payload.x, payload.y, anchor, captureId]);
    return json(response, 201, { comment: commentRow(result.rows[0], user) });
  }

  if (request.method === "PATCH") {
    const user = await getZeroUser(request);
    const payload = await readJson(request);
    const pageUrl = cleanPageUrl(payload.pageUrl);
    const hasStatus = Object.hasOwn(payload, "status");
    const hasBody = Object.hasOwn(payload, "body");
    const body = hasBody ? String(payload.body || "").trim().slice(0, 800) : null;
    if (!Number.isInteger(payload.id) || !pageUrl || (!hasStatus && !hasBody)) throw new HttpError("A valid comment, page URL, and update are required", 400);
    if (hasStatus && !["open", "resolved"].includes(payload.status)) throw new HttpError("A valid comment status is required", 400);
    if (hasBody && !body) throw new HttpError("Feedback is required", 400);
    await requirePageAccess(pageUrl, user);
    const existing = await pool.query("SELECT * FROM comments WHERE id = $1 AND page_url = $2", [payload.id, pageUrl]);
    if (!existing.rowCount) throw new HttpError("That comment was not found", 404);
    if (hasBody && (!user || existing.rows[0].zero_user_id !== user.id)) throw new HttpError("Only the comment author can edit its text. Sign in with the same Zero account that created it.", 403);
    const result = await pool.query(`UPDATE comments SET body = CASE WHEN $1::boolean THEN $2 ELSE body END,
      status = CASE WHEN $3::boolean THEN $4 ELSE status END WHERE id = $5 AND page_url = $6 RETURNING *`,
    [hasBody, body, hasStatus, hasStatus ? payload.status : null, payload.id, pageUrl]);
    return json(response, 200, { ok: true, comment: commentRow(result.rows[0], user) });
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
    ON CONFLICT (page_url) DO UPDATE SET allowed_domain = EXCLUDED.allowed_domain, updated_at = CURRENT_TIMESTAMP`, [pageUrl, allowedDomain, user.id]);
  return json(response, 200, { access: describeAccess(await pagePolicy(pageUrl), user) });
}

function isPrivateIp(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  if (value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value)) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIp(mapped[1]) : false;
}

const checkedHosts = new Map();
async function assertPublicUrl(value) {
  const pageUrl = cleanPageUrl(value);
  if (!pageUrl) throw new HttpError("Only public HTTP and HTTPS pages can be captured", 400);
  const url = new URL(pageUrl);
  if (url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new HttpError("Private network pages must use the extension capture fallback", 400);
  const cached = checkedHosts.get(url.hostname);
  if (cached && Date.now() - cached < 60_000) return pageUrl;
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw new HttpError("Pinpoint could not resolve that website", 400); }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new HttpError("Private network pages must use the extension capture fallback", 400);
  checkedHosts.set(url.hostname, Date.now());
  return pageUrl;
}

async function resolveCommentAnchors(page, comments) {
  if (!comments.length) return [];
  return page.evaluate((items) => items.map((item) => {
    const anchor = item.anchor;
    let element = null;
    if (anchor?.selector) {
      try { element = document.querySelector(anchor.selector); } catch { element = null; }
    }
    if (!element && anchor?.text) {
      const tag = anchor.tag && /^[a-z0-9-]+$/.test(anchor.tag) ? anchor.tag : "body *";
      const wanted = anchor.text.replace(/\s+/g, " ").trim();
      try {
        element = [...document.querySelectorAll(tag)].slice(0, 1500).find((candidate) => {
          const text = (candidate.innerText || candidate.textContent || "").replace(/\s+/g, " ").trim();
          return text === wanted || (wanted.length >= 24 && text.includes(wanted));
        }) || null;
      } catch { element = null; }
    }
    if (!element) return { commentId: item.id, matched: false };
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return { commentId: item.id, matched: false };
    return {
      commentId: item.id, matched: true,
      x: Math.max(0, Math.min(100, ((rect.left + scrollX + rect.width * anchor.offsetX) / Math.max(1, document.documentElement.scrollWidth)) * 100)),
      y: Math.max(0, Math.min(100, ((rect.top + scrollY + rect.height * anchor.offsetY) / Math.max(1, document.documentElement.scrollHeight)) * 100)),
    };
  }), comments);
}

async function serializeDomArchive(page, finalUrl) {
  const archive = await page.evaluate(({ baseUrl }) => {
    const clone = document.documentElement.cloneNode(true);
    const liveCanvases = [...document.querySelectorAll("canvas")];
    const clonedCanvases = [...clone.querySelectorAll("canvas")];
    liveCanvases.forEach((canvas, index) => {
      try {
        const image = document.createElement("img");
        image.src = canvas.toDataURL("image/png");
        image.alt = canvas.getAttribute("aria-label") || "Archived chart";
        image.width = canvas.width;
        image.height = canvas.height;
        image.style.cssText = canvas.style.cssText;
        clonedCanvases[index]?.replaceWith(image);
      } catch { clonedCanvases[index]?.remove(); }
    });
    const liveInputs = [...document.querySelectorAll("input")];
    [...clone.querySelectorAll("input")].forEach((input, index) => {
      const live = liveInputs[index];
      if (!live) return;
      if (["checkbox", "radio"].includes(live.type)) input.toggleAttribute("checked", live.checked);
      else input.setAttribute("value", live.value || "");
    });
    const liveTextareas = [...document.querySelectorAll("textarea")];
    [...clone.querySelectorAll("textarea")].forEach((textarea, index) => { textarea.textContent = liveTextareas[index]?.value || ""; });
    clone.querySelectorAll("script,noscript,iframe,frame,object,embed,portal,pinpoint-feedback-root,agent-storefront").forEach((element) => element.remove());
    clone.querySelectorAll('meta[http-equiv],base,link[rel="preload"],link[rel="modulepreload"],link[rel="prefetch"],link[rel="manifest"]').forEach((element) => element.remove());
    clone.querySelectorAll("*").forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src" || name === "action") && value.startsWith("javascript:"))) element.removeAttribute(attribute.name);
      });
      if (element.matches("form")) element.setAttribute("action", "");
      if (element.matches("button,input,textarea,select")) element.setAttribute("tabindex", "-1");
    });
    let head = clone.querySelector("head");
    if (!head) { head = document.createElement("head"); clone.prepend(head); }
    const charset = document.createElement("meta"); charset.setAttribute("charset", "utf-8");
    const viewport = document.createElement("meta"); viewport.name = "viewport"; viewport.content = "width=device-width,initial-scale=1";
    const base = document.createElement("base"); base.href = baseUrl;
    head.prepend(charset, viewport, base);
    return "<!doctype html>" + clone.outerHTML;
  }, { baseUrl: finalUrl });
  if (Buffer.byteLength(archive, "utf8") > MAX_ARCHIVE_BYTES) throw new HttpError("This page's DOM archive is too large; Pinpoint will use the image fallback", 413);
  return archive;
}

function sanitizeArchiveMarkup(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    // Some sites ship machine-only catalog markup and remove it for human
    // browsers with JavaScript. Since archives strip page scripts, remove the
    // catalog itself so it cannot leak into the human review surface.
    .replace(/<agent-storefront\b[^>]*>[\s\S]*?<\/agent-storefront\s*>/gi, "")
    .replace(/<agent-storefront\b[^>]*\/?>/gi, "")
    .replace(/<(iframe|frame|object|embed|portal)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|frame|object|embed|portal)\b[^>]*\/?>/gi, "")
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/\s+(?:on[a-z0-9_-]+|srcdoc|nonce)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src|action)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, "")
    .replace(/\s+(href|src|action)\s*=\s*javascript:[^\s>]*/gi, "");
}

function escapeHtmlAttribute(value) {
  return String(value).replace(/[&"<>]/g, (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character]);
}

function renderArchiveHtml(storedHtml, pageUrl) {
  const nonce = randomUUID().replaceAll("-", "");
  const csp = `default-src 'none'; img-src https: http: data: blob:; style-src https: http: 'unsafe-inline'; font-src https: http: data:; media-src https: http: data:; script-src 'nonce-${nonce}'; connect-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri *`;
  const head = `<base href="${escapeHtmlAttribute(pageUrl)}"><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}"><style data-pinpoint-runtime>${ARCHIVE_STYLE}</style>`;
  const runtime = `<script nonce="${nonce}" data-pinpoint-runtime>${ARCHIVE_RUNTIME}</script>`;
  let html = sanitizeArchiveMarkup(storedHtml);
  if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (match) => `${match}${head}`);
  else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${head}</head>`);
  else html = `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
  if (/<\/body\s*>/i.test(html)) html = html.replace(/<\/body\s*>/i, `${runtime}</body>`);
  else html = html.replace(/<\/html\s*>/i, `${runtime}</html>`);
  return { html, nonce, csp };
}

function titleFromHtml(html, fallback) {
  const match = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!match) return fallback;
  return match[1].replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, 200) || fallback;
}

async function capturePublicPageFromHtml(pageUrl, requestedWidth, requestedHeight, browserError) {
  console.error(`Browser archive unavailable for ${pageUrl}; using the HTML archive path`, browserError);
  const response = await fetch(pageUrl, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PinpointArchive/1.0; +https://withzero.xyz)" },
  });
  if (!response.ok) throw new HttpError(`The website returned HTTP ${response.status}`, 502);
  const finalUrl = await assertPublicUrl(response.url);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html")) throw new HttpError("That URL did not return an HTML page", 415);
  const rawHtml = await response.text();
  const html = rawHtml.replace(/<canvas\b([^>]*\baria-label=(['"])([\s\S]*?)\2[^>]*)>[\s\S]*?<\/canvas\s*>/gi,
    (_match, _attributes, quote, label) => `<div class="pinpoint-canvas-fallback" role="img" aria-label=${quote}${label}${quote}><span>${label}</span></div>`);
  if (Buffer.byteLength(html, "utf8") > MAX_ARCHIVE_BYTES) throw new HttpError("This page's HTML archive is too large; Pinpoint will use the image fallback", 413);
  const width = Math.max(1024, Math.min(1920, Math.round(Number(requestedWidth) || 1440)));
  const height = Math.max(720, Math.min(1200, Math.round(Number(requestedHeight) || 900)));
  return {
    artifactType: "archive", pageTitle: titleFromHtml(html, new URL(finalUrl).hostname), contentType: "text/html",
    image: null, archiveHtml: html, pageWidth: width, pageHeight: height, viewportWidth: width, viewportHeight: height,
    scrollX: 0, scrollY: 0, devicePixelRatio: 1, positions: [],
  };
}

async function capturePublicPageWithBrowser(pageUrl, requestedWidth = 1440, requestedHeight = 900) {
  await assertPublicUrl(pageUrl);
  const viewport = {
    width: Math.max(1024, Math.min(1920, Math.round(Number(requestedWidth) || 1440))),
    height: Math.max(720, Math.min(1200, Math.round(Number(requestedHeight) || 900))),
    deviceScaleFactor: 1,
  };
  const browser = await puppeteer.launch({
    args: [...chromium.args, "--hide-scrollbars", "--disable-dev-shm-usage"], defaultViewport: viewport,
    executablePath: await chromium.executablePath(), headless: "shell",
  });
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(45_000);
    await page.setRequestInterception(true);
    page.on("request", (intercepted) => {
      const requestUrl = intercepted.url();
      if (/^(data|blob|about):/.test(requestUrl)) return intercepted.continue().catch(() => undefined);
      assertPublicUrl(requestUrl).then(() => intercepted.continue()).catch(() => intercepted.abort("blockedbyclient"));
    });
    await page.goto(pageUrl, { waitUntil: "networkidle2", timeout: 45_000 });
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const limit = Math.min(document.documentElement.scrollHeight, 18_000);
      for (let y = 0; y < limit; y += Math.max(500, innerHeight * 0.8)) { scrollTo(0, y); await delay(110); }
      scrollTo(0, 0); await delay(250);
    });
    const dimensions = await page.evaluate(() => ({
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight),
      title: document.title || location.hostname, finalUrl: location.href,
    }));
    await assertPublicUrl(dimensions.finalUrl);
    const width = Math.min(MAX_CAPTURE_WIDTH, Math.max(1, Math.ceil(dimensions.width)));
    const height = Math.min(MAX_CAPTURE_HEIGHT, Math.max(1, Math.ceil(dimensions.height)));
    const commentsResult = await pool.query("SELECT id, anchor_json FROM comments WHERE page_url = $1 AND anchor_json IS NOT NULL", [pageUrl]);
    const positions = await resolveCommentAnchors(page, commentsResult.rows.map((row) => ({ id: Number(row.id), anchor: row.anchor_json })));
    const archiveHtml = await serializeDomArchive(page, dimensions.finalUrl);
    return {
      artifactType: "archive", pageTitle: String(dimensions.title).slice(0, 200), contentType: "text/html", image: null, archiveHtml,
      pageWidth: width, pageHeight: height, viewportWidth: width, viewportHeight: height,
      scrollX: 0, scrollY: 0, devicePixelRatio: 1, positions,
    };
  } finally {
    await browser.close();
  }
}

async function capturePublicPage(pageUrl, requestedWidth = 1440, requestedHeight = 900) {
  try { return await capturePublicPageWithBrowser(pageUrl, requestedWidth, requestedHeight); }
  catch (error) { return capturePublicPageFromHtml(pageUrl, requestedWidth, requestedHeight, error); }
}

async function storeCapture({ pageUrl, createdBy, source, positions = [], ...capture }) {
  const captureId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO captures (id, page_url, page_title, content_type, image, archive_html, artifact_type, page_width, page_height, viewport_width, viewport_height, scroll_x, scroll_y, device_pixel_ratio, source, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [captureId, pageUrl, capture.pageTitle, capture.contentType, capture.image || null, capture.archiveHtml || null, capture.artifactType || "image", capture.pageWidth, capture.pageHeight, capture.viewportWidth, capture.viewportHeight, capture.scrollX, capture.scrollY, capture.devicePixelRatio, source, createdBy]);
    for (const position of positions) {
      await client.query(`INSERT INTO capture_comment_positions (capture_id, comment_id, x, y, matched)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (capture_id, comment_id) DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, matched=EXCLUDED.matched`,
      [captureId, position.commentId, position.matched ? position.x : null, position.matched ? position.y : null, Boolean(position.matched)]);
    }
    await client.query("COMMIT");
    return captureId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

let captureQueue = Promise.resolve();
function queueCapture(task) {
  const result = captureQueue.then(task, task);
  captureQueue = result.catch(() => undefined);
  return result;
}

async function handleCaptures(request, response) {
  if (request.method !== "POST") throw new HttpError("Method not allowed", 405);
  const user = await getZeroUser(request, true);
  const payload = await readJson(request);
  const pageUrl = cleanPageUrl(payload.pageUrl);
  if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
  await requirePageAccess(pageUrl, user);
  const capture = await queueCapture(() => capturePublicPage(pageUrl, payload.viewportWidth, payload.viewportHeight));
  const captureId = await storeCapture({ ...capture, pageUrl, createdBy: user.id, source: "zero-dom" });
  return json(response, 201, { ok: true, captureId, artifactType: "archive", source: "zero-dom", capturedAt: new Date().toISOString() });
}

function captureHeaders(capture) {
  return {
    "Content-Type": capture.content_type,
    "X-Page-Title": encodeURIComponent(capture.page_title), "X-Page-Width": String(capture.page_width),
    "X-Page-Height": String(capture.page_height), "X-Viewport-Width": String(capture.viewport_width),
    "X-Viewport-Height": String(capture.viewport_height), "X-Scroll-X": String(capture.scroll_x),
    "X-Scroll-Y": String(capture.scroll_y), "X-Device-Pixel-Ratio": String(capture.device_pixel_ratio),
    "X-Captured-At": new Date(capture.created_at).toISOString(), "X-Capture-Id": capture.id,
    "X-Capture-Source": capture.source,
  };
}

async function findCapture(pageUrl, captureId) {
  const result = captureId
    ? await pool.query("SELECT * FROM captures WHERE id = $1 AND page_url = $2", [captureId, pageUrl])
    : await pool.query("SELECT * FROM captures WHERE page_url = $1 ORDER BY created_at DESC LIMIT 1", [pageUrl]);
  return result.rows[0] || null;
}

const domRefreshes = new Map();
async function ensureDomArchive(pageUrl) {
  if (domRefreshes.has(pageUrl)) return domRefreshes.get(pageUrl);
  const refresh = queueCapture(async () => {
    const capture = await capturePublicPage(pageUrl);
    const captureId = await storeCapture({ ...capture, pageUrl, createdBy: "system-migration", source: "zero-dom-migration" });
    return findCapture(pageUrl, captureId);
  });
  domRefreshes.set(pageUrl, refresh);
  try { return await refresh; }
  finally { domRefreshes.delete(pageUrl); }
}

async function handleArtifact(request, response, url) {
  if (request.method !== "GET") throw new HttpError("Method not allowed", 405);
  const user = await getZeroUser(request);
  const pageUrl = cleanPageUrl(url.searchParams.get("url"));
  const captureId = cleanCaptureId(url.searchParams.get("capture"));
  if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
  await requirePageAccess(pageUrl, user);
  let capture = await findCapture(pageUrl, captureId);
  if (!capture) throw new HttpError(captureId ? "That review revision was not found" : "No review revision has been shared yet", 404);
  if (!captureId && !capture.archive_html) {
    try { capture = await ensureDomArchive(pageUrl); }
    catch (error) { console.error(`Unable to create an interactive DOM revision for ${pageUrl}`, error); }
  }
  return json(response, 200, {
    captureId: capture.id,
    artifactType: capture.artifact_type || (capture.archive_html ? "archive" : "image"),
    pageTitle: capture.page_title,
    pageWidth: Number(capture.page_width),
    pageHeight: Number(capture.page_height),
    viewportWidth: Number(capture.viewport_width),
    viewportHeight: Number(capture.viewport_height),
    scrollX: Number(capture.scroll_x),
    scrollY: Number(capture.scroll_y),
    source: capture.source,
    createdAt: new Date(capture.created_at).toISOString(),
  });
}

async function handleArchive(request, response, url) {
  if (request.method !== "GET") throw new HttpError("Method not allowed", 405);
  const user = await getZeroUser(request);
  const pageUrl = cleanPageUrl(url.searchParams.get("url"));
  const captureId = cleanCaptureId(url.searchParams.get("capture"));
  if (!pageUrl || !captureId) throw new HttpError("A valid page URL and review revision are required", 400);
  await requirePageAccess(pageUrl, user);
  const capture = await findCapture(pageUrl, captureId);
  if (!capture?.archive_html) throw new HttpError("This revision only has an image fallback", 404);
  const rendered = renderArchiveHtml(capture.archive_html, capture.page_url);
  return send(response, 200, rendered.html, {
    ...captureHeaders(capture),
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(rendered.html, "utf8")),
    "Content-Security-Policy": `sandbox allow-scripts; ${rendered.csp}`,
    "X-Content-Type-Options": "nosniff",
  });
}

async function handleSnapshot(request, response, url) {
  const pageUrl = cleanPageUrl(url.searchParams.get("url"));
  if (!pageUrl) throw new HttpError("A valid page URL is required", 400);
  if (request.method === "GET") {
    const user = await getZeroUser(request);
    const captureId = cleanCaptureId(url.searchParams.get("capture"));
    await requirePageAccess(pageUrl, user);
    const capture = await findCapture(pageUrl, captureId);
    if (!capture) throw new HttpError(captureId ? "That capture revision was not found" : "No page capture has been shared yet", 404);
    if (!capture.image) throw new HttpError("This revision is an interactive DOM archive, not an image", 409);
    return send(response, 200, capture.image, { ...captureHeaders(capture), "Content-Length": String(capture.image.length) });
  }
  if (request.method !== "POST") throw new HttpError("Method not allowed", 405);
  const user = await getZeroUser(request, true);
  await requirePageAccess(pageUrl, user);
  const contentType = String(request.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
  if (!["image/jpeg", "image/png"].includes(contentType)) throw new HttpError("The page capture must be a JPEG or PNG image", 415);
  const image = await readBody(request, MAX_SNAPSHOT_BYTES);
  if (!image.length) throw new HttpError("The page capture is empty", 400);
  const captureId = await storeCapture({
    pageUrl, artifactType: "image", pageTitle: decodedTitle(request), contentType, image, archiveHtml: null,
    pageWidth: finiteHeader(request, "x-page-width"), pageHeight: finiteHeader(request, "x-page-height"),
    viewportWidth: finiteHeader(request, "x-viewport-width"), viewportHeight: finiteHeader(request, "x-viewport-height"),
    scrollX: finiteHeader(request, "x-scroll-x"), scrollY: finiteHeader(request, "x-scroll-y"),
    devicePixelRatio: finiteHeader(request, "x-device-pixel-ratio", 1), source: "extension", createdBy: user.id,
  });
  return json(response, 201, { ok: true, captureId, source: "extension", capturedAt: new Date().toISOString() });
}

async function serveStatic(response, pathname) {
  const fileName = pathname === "/" || pathname === "/index.html" ? "index.html" : pathname === "/app.js" ? "app.js" : pathname === "/styles.css" ? "styles.css" : pathname === "/scroll.css" ? "scroll.css" : pathname === "/full-width.css" ? "full-width.css" : null;
  if (!fileName) throw new HttpError("Not found", 404);
  const contentTypes = { "index.html": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "styles.css": "text/css; charset=utf-8", "scroll.css": "text/css; charset=utf-8", "full-width.css": "text/css; charset=utf-8" };
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
  await pool.query("ALTER TABLE comments ADD COLUMN IF NOT EXISTS anchor_json JSONB");
  await pool.query("ALTER TABLE comments ADD COLUMN IF NOT EXISTS capture_id TEXT");
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
  await pool.query(`CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY, page_url TEXT NOT NULL, page_title TEXT NOT NULL, content_type TEXT NOT NULL, image BYTEA,
    archive_html TEXT, artifact_type TEXT NOT NULL DEFAULT 'image',
    page_width DOUBLE PRECISION NOT NULL, page_height DOUBLE PRECISION NOT NULL,
    viewport_width DOUBLE PRECISION NOT NULL, viewport_height DOUBLE PRECISION NOT NULL,
    scroll_x DOUBLE PRECISION NOT NULL, scroll_y DOUBLE PRECISION NOT NULL,
    device_pixel_ratio DOUBLE PRECISION NOT NULL, source TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query("ALTER TABLE captures ALTER COLUMN image DROP NOT NULL");
  await pool.query("ALTER TABLE captures ADD COLUMN IF NOT EXISTS archive_html TEXT");
  await pool.query("ALTER TABLE captures ADD COLUMN IF NOT EXISTS artifact_type TEXT NOT NULL DEFAULT 'image'");
  await pool.query("UPDATE captures SET artifact_type = CASE WHEN archive_html IS NOT NULL THEN 'archive' ELSE 'image' END WHERE artifact_type IS NULL OR artifact_type NOT IN ('archive', 'image')");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_captures_page_created_at ON captures(page_url, created_at DESC)");
  await pool.query(`CREATE TABLE IF NOT EXISTS capture_comment_positions (
    capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    x DOUBLE PRECISION, y DOUBLE PRECISION, matched BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (capture_id, comment_id)
  )`);
  await pool.query(`INSERT INTO captures (id, page_url, page_title, content_type, image, page_width, page_height, viewport_width, viewport_height, scroll_x, scroll_y, device_pixel_ratio, source, created_by, created_at)
    SELECT 'legacy-' || md5(page_url || captured_at::text), page_url, page_title, content_type, image, page_width, page_height, viewport_width, viewport_height, scroll_x, scroll_y, device_pixel_ratio, 'legacy', 'legacy-import', captured_at
    FROM snapshots ON CONFLICT (id) DO NOTHING`);
  await pool.query(`INSERT INTO comments (author, body, page_url, page_title, zero_user_id, x, y, status, created_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz
    WHERE NOT EXISTS (SELECT 1 FROM comments WHERE page_url=$3 AND author=$1 AND body=$2)`,
  ["j.a.nakagawa", "Lets get rid of this stat", "https://zeroclick.ai/trends", "AI Purchase Trends | ZeroClick", "legacy-import", 23.429242513211978, 73.53608715388107, "open", "2026-08-24T20:53:20Z"]);
}

await initDatabase();

async function migrateLegacyPagesToDomArchives() {
  const result = await pool.query(`SELECT DISTINCT ON (candidate.page_url) candidate.page_url
    FROM captures candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM captures archive
      WHERE archive.page_url = candidate.page_url AND archive.artifact_type = 'archive'
    )
    ORDER BY candidate.page_url, candidate.created_at DESC
    LIMIT 5`);
  for (const row of result.rows) {
    try {
      const capture = await queueCapture(() => capturePublicPage(row.page_url));
      await storeCapture({ ...capture, pageUrl: row.page_url, createdBy: "system-migration", source: "zero-dom-migration" });
      console.log(`Migrated ${row.page_url} to an interactive DOM archive`);
    } catch (error) {
      console.error(`Unable to migrate ${row.page_url} to a DOM archive`, error);
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(response, 204, "");
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") return json(response, 200, { ok: true, service: "pinpoint-zero", captureEngine: "zero-dom" });
    if (url.pathname === "/api/comments") return await handleComments(request, response, url);
    if (url.pathname === "/api/access") return await handleAccess(request, response, url);
    if (url.pathname === "/api/captures") return await handleCaptures(request, response);
    if (url.pathname === "/api/artifact") return await handleArtifact(request, response, url);
    if (url.pathname === "/api/archive") return await handleArchive(request, response, url);
    if (url.pathname === "/api/snapshot") return await handleSnapshot(request, response, url);
    return await serveStatic(response, url.pathname);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    console.error(error);
    return json(response, status, { error: status === 500 ? "Pinpoint encountered an unexpected error" : error.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Pinpoint listening on ${PORT}`);
  setTimeout(() => migrateLegacyPagesToDomArchives().catch(console.error), 1_000);
});

process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
