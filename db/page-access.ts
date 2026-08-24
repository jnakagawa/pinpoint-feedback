import type { ZeroUser } from "../app/zero-auth";
import { getCommentsDb } from "./comments";

type CommentsDb = Awaited<ReturnType<typeof getCommentsDb>>;

export type StoredPageAccess = {
  pageUrl: string;
  allowedDomain: string;
  ownerZeroUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type PageAccessState = {
  allowedDomain: string | null;
  emailDomain: string | null;
  hasAccess: boolean;
  canManage: boolean;
};

export class PageAccessError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "PageAccessError";
    this.status = status;
  }
}

export function getEmailDomain(email: string | null) {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) return null;
  const domain = normalized.slice(at + 1);
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : null;
}

function cleanDomain(value: unknown) {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase().replace(/^@/, "");
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
    ? domain
    : null;
}

export async function readPageAccess(db: CommentsDb, pageUrl: string) {
  return db.prepare(`SELECT page_url AS pageUrl, allowed_domain AS allowedDomain,
    owner_zero_user_id AS ownerZeroUserId, created_at AS createdAt,
    updated_at AS updatedAt FROM page_access WHERE page_url = ?`)
    .bind(pageUrl)
    .first<StoredPageAccess>();
}

export function describePageAccess(policy: StoredPageAccess | null, user: ZeroUser | null): PageAccessState {
  const emailDomain = getEmailDomain(user?.email ?? null);
  return {
    allowedDomain: policy?.allowedDomain || null,
    emailDomain,
    hasAccess: !policy || emailDomain === policy.allowedDomain,
    canManage: policy ? policy.ownerZeroUserId === user?.id : Boolean(emailDomain),
  };
}

export async function requirePageAccess(db: CommentsDb, user: ZeroUser | null, pageUrl: string) {
  const policy = await readPageAccess(db, pageUrl);
  const access = describePageAccess(policy, user);
  if (policy && !user) {
    throw new PageAccessError(`Sign in with a Zero account using an @${policy.allowedDomain} email.`, 401);
  }
  if (!access.hasAccess) {
    throw new PageAccessError(`This page is restricted to Zero accounts with an @${policy?.allowedDomain} email.`);
  }
  return access;
}

export async function setPageAccess(db: CommentsDb, user: ZeroUser, pageUrl: string, value: unknown) {
  const existing = await readPageAccess(db, pageUrl);
  if (existing && existing.ownerZeroUserId !== user.id) {
    throw new PageAccessError("Only the person who protected this page can change its domain restriction.");
  }

  if (value === null) {
    if (existing) {
      await db.prepare("DELETE FROM page_access WHERE page_url = ? AND owner_zero_user_id = ?")
        .bind(pageUrl, user.id)
        .run();
    }
    return describePageAccess(null, user);
  }

  const emailDomain = getEmailDomain(user.email);
  if (!emailDomain) {
    throw new PageAccessError("Your Zero account does not include a usable domain email.", 400);
  }
  const allowedDomain = cleanDomain(value);
  if (!allowedDomain) throw new PageAccessError("Enter a valid email domain, such as studio.com.", 400);
  if (allowedDomain !== emailDomain) {
    throw new PageAccessError(`You can only protect a page with your own Zero email domain: @${emailDomain}.`);
  }

  if (existing) {
    await db.prepare(`UPDATE page_access SET allowed_domain = ?, updated_at = CURRENT_TIMESTAMP
      WHERE page_url = ? AND owner_zero_user_id = ?`)
      .bind(allowedDomain, pageUrl, user.id)
      .run();
  } else {
    await db.prepare(`INSERT INTO page_access (page_url, allowed_domain, owner_zero_user_id)
      VALUES (?, ?, ?)`)
      .bind(pageUrl, allowedDomain, user.id)
      .run();
  }

  const policy = await readPageAccess(db, pageUrl);
  return describePageAccess(policy, user);
}
