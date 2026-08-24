import { getCommentsDb } from "../../../db/comments";
import {
  describePageAccess,
  PageAccessError,
  readPageAccess,
  setPageAccess,
} from "../../../db/page-access";
import { requireZeroUser, ZeroAuthError } from "../../zero-auth";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
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

function errorResponse(error: unknown) {
  if (error instanceof ZeroAuthError) return json({ error: error.message }, { status: 401 });
  if (error instanceof PageAccessError) return json({ error: error.message }, { status: error.status });
  return json({ error: error instanceof Error ? error.message : "Unable to update page protection" }, { status: 500 });
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
    const policy = await readPageAccess(db, pageUrl);
    return json({ access: describePageAccess(policy, zeroUser) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const zeroUser = await requireZeroUser(request);
    const payload = (await request.json()) as { pageUrl?: string; allowedDomain?: string | null };
    const pageUrl = cleanPageUrl(payload.pageUrl);
    if (!pageUrl) return json({ error: "A valid page URL is required" }, { status: 400 });
    if (!("allowedDomain" in payload)) return json({ error: "An email domain is required" }, { status: 400 });
    const db = await getCommentsDb();
    const access = await setPageAccess(db, zeroUser, pageUrl, payload.allowedDomain);
    return json({ access });
  } catch (error) {
    return errorResponse(error);
  }
}
