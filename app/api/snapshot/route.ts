import { env } from "cloudflare:workers";
import { getCommentsDb } from "../../../db/comments";
import { PageAccessError, requirePageAccess } from "../../../db/page-access";
import { getZeroUser, requireZeroUser, ZeroAuthError } from "../../zero-auth";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const metadataHeaders = [
  "X-Page-Title",
  "X-Page-Width",
  "X-Page-Height",
  "X-Viewport-Width",
  "X-Viewport-Height",
  "X-Scroll-X",
  "X-Scroll-Y",
  "X-Device-Pixel-Ratio",
].join(", ");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": `Authorization, Content-Type, ${metadataHeaders}`,
  "Access-Control-Expose-Headers": `${metadataHeaders}, X-Captured-At`,
  "Cache-Control": "no-store",
};

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { ...corsHeaders, ...init?.headers } });
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

function finiteHeader(request: Request, name: string, fallback = 0) {
  const value = Number(request.headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function pageTitle(request: Request) {
  const encoded = request.headers.get("x-page-title") || "";
  try {
    return decodeURIComponent(encoded).trim().slice(0, 200) || "Untitled page";
  } catch {
    return encoded.trim().slice(0, 200) || "Untitled page";
  }
}

async function snapshotKey(pageUrl: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pageUrl));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `snapshots/${hash}`;
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
    const zeroUser = await getZeroUser(request);
    const pageUrl = cleanPageUrl(new URL(request.url).searchParams.get("url"));
    if (!pageUrl) return json({ error: "A valid page URL is required" }, { status: 400 });

    const db = await getCommentsDb();
    await requirePageAccess(db, zeroUser, pageUrl);
    const snapshot = await env.SNAPSHOTS.get(await snapshotKey(pageUrl));
    if (!snapshot) return json({ error: "No page capture has been shared yet" }, { status: 404 });

    const metadata = snapshot.customMetadata || {};
    return new Response(snapshot.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": snapshot.httpMetadata?.contentType || "image/jpeg",
        "Content-Length": String(snapshot.size),
        "X-Page-Title": encodeURIComponent(metadata.pageTitle || "Untitled page"),
        "X-Page-Width": metadata.pageWidth || "0",
        "X-Page-Height": metadata.pageHeight || "0",
        "X-Viewport-Width": metadata.viewportWidth || "0",
        "X-Viewport-Height": metadata.viewportHeight || "0",
        "X-Scroll-X": metadata.scrollX || "0",
        "X-Scroll-Y": metadata.scrollY || "0",
        "X-Device-Pixel-Ratio": metadata.devicePixelRatio || "1",
        "X-Captured-At": metadata.capturedAt || snapshot.uploaded.toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(error, "Unable to load the page capture");
  }
}

export async function POST(request: Request) {
  try {
    const zeroUser = await requireZeroUser(request);
    const pageUrl = cleanPageUrl(new URL(request.url).searchParams.get("url"));
    if (!pageUrl) return json({ error: "A valid page URL is required" }, { status: 400 });

    const contentType = request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
    if (contentType !== "image/jpeg" && contentType !== "image/png") {
      return json({ error: "The page capture must be a JPEG or PNG image" }, { status: 415 });
    }
    const declaredSize = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_SNAPSHOT_BYTES) {
      return json({ error: "The page capture is too large" }, { status: 413 });
    }

    const db = await getCommentsDb();
    await requirePageAccess(db, zeroUser, pageUrl);
    const image = await request.arrayBuffer();
    if (!image.byteLength || image.byteLength > MAX_SNAPSHOT_BYTES) {
      return json({ error: image.byteLength ? "The page capture is too large" : "The page capture is empty" }, { status: image.byteLength ? 413 : 400 });
    }

    const capturedAt = new Date().toISOString();
    await env.SNAPSHOTS.put(await snapshotKey(pageUrl), image, {
      httpMetadata: { contentType },
      customMetadata: {
        pageTitle: pageTitle(request),
        pageWidth: String(finiteHeader(request, "x-page-width")),
        pageHeight: String(finiteHeader(request, "x-page-height")),
        viewportWidth: String(finiteHeader(request, "x-viewport-width")),
        viewportHeight: String(finiteHeader(request, "x-viewport-height")),
        scrollX: String(finiteHeader(request, "x-scroll-x")),
        scrollY: String(finiteHeader(request, "x-scroll-y")),
        devicePixelRatio: String(finiteHeader(request, "x-device-pixel-ratio", 1)),
        capturedAt,
      },
    });

    return json({ ok: true, capturedAt }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to save the page capture");
  }
}
