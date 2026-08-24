"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";

type Comment = {
  id: number;
  author: string;
  body: string;
  x: number;
  y: number;
  status: "open" | "resolved";
  createdAt: string;
};

const PUBLIC_SITE_URL = "https://pinpoint-feedback.transqualia.chatgpt.site";
const DEFAULT_REVIEW_URL = "https://kanso.studio/";

const seedComments: Comment[] = [
  {
    id: 1,
    author: "Alex Morgan",
    body: "Can we make this headline feel a little more specific to the studio?",
    x: 53,
    y: 38,
    status: "open",
    createdAt: "2026-08-24T19:00:00.000Z",
  },
  {
    id: 2,
    author: "Sam Lee",
    body: "This image treatment is great. Could we carry the soft orange into the footer?",
    x: 86,
    y: 74,
    status: "open",
    createdAt: "2026-08-24T18:56:00.000Z",
  },
];

function formatTime(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

function normalizeReviewUrl(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export default function Home() {
  const [comments, setComments] = useState<Comment[]>(seedComments);
  const [mode, setMode] = useState<"comment" | "navigate">("comment");
  const [filter, setFilter] = useState<"open" | "resolved">("open");
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number } | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [address, setAddress] = useState(DEFAULT_REVIEW_URL);
  const [activeAddress, setActiveAddress] = useState(DEFAULT_REVIEW_URL);
  const [panelOpen, setPanelOpen] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedUrl = new URLSearchParams(window.location.search).get("url");
      const normalized = requestedUrl ? normalizeReviewUrl(requestedUrl) : null;
      if (normalized) {
        setAddress(normalized);
        setActiveAddress(normalized);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const reviewUrl = normalizeReviewUrl(activeAddress) || DEFAULT_REVIEW_URL;
    fetch(`/api/comments?url=${encodeURIComponent(reviewUrl)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to open this review");
        return data;
      })
      .then((data: { comments?: Comment[] }) => {
        setComments(data.comments || []);
      })
      .catch((error: Error) => {
        setComments([]);
        setToast(error.message);
      });
  }, [activeAddress]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleComments = useMemo(
    () => comments.filter((comment) => comment.status === filter),
    [comments, filter],
  );
  const openCount = comments.filter((comment) => comment.status === "open").length;

  function placeComment(event: MouseEvent<HTMLDivElement>) {
    if (mode !== "comment") return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, form, a")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(3, Math.min(97, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(4, Math.min(96, ((event.clientY - rect.top) / rect.height) * 100));
    setDraftPoint({ x, y });
    setSelectedId(null);
    window.setTimeout(() => canvasRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 20);
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!draftPoint || !body.trim()) return;
    setSaving(true);
    const pending: Omit<Comment, "id" | "createdAt"> = {
      author: author.trim() || "Guest reviewer",
      body: body.trim(),
      x: Number(draftPoint.x.toFixed(2)),
      y: Number(draftPoint.y.toFixed(2)),
      status: "open",
    };
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pending,
          pageUrl: normalizeReviewUrl(activeAddress) || DEFAULT_REVIEW_URL,
          pageTitle: `${displayHost} review`,
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error || "Unable to save feedback");
      }
      const data = (await response.json()) as { comment: Comment };
      setComments((current) => [...current, data.comment]);
      setSelectedId(data.comment.id);
      setToast("Comment saved");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Unable to save feedback");
    } finally {
      setSaving(false);
      setDraftPoint(null);
      setBody("");
    }
  }

  async function toggleResolved(comment: Comment) {
    const status = comment.status === "open" ? "resolved" : "open";
    setComments((current) => current.map((item) => (item.id === comment.id ? { ...item, status } : item)));
    const response = await fetch("/api/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: comment.id,
        status,
        pageUrl: normalizeReviewUrl(activeAddress) || DEFAULT_REVIEW_URL,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setComments((current) => current.map((item) => (item.id === comment.id ? { ...item, status: comment.status } : item)));
      const error = response ? await response.json().catch(() => ({})) as { error?: string } : {};
      setToast(error.error || "Unable to update this feedback");
      return;
    }
    setToast(status === "resolved" ? "Marked resolved" : "Reopened");
  }

  function loadAddress(event: FormEvent) {
    event.preventDefault();
    const next = address.trim();
    if (!next) return;
    const normalized = normalizeReviewUrl(next);
    if (!normalized) {
      setToast("Enter a valid website URL");
      return;
    }
    setAddress(normalized);
    setActiveAddress(normalized);
    setToast("Review canvas updated");
  }

  function copyShareLink() {
    navigator.clipboard?.writeText(shareLink).then(() => setToast("Reviewer link copied"));
  }

  const displayHost = (() => {
    try {
      return new URL(activeAddress).hostname;
    } catch {
      return activeAddress;
    }
  })();
  const shareLink = `${PUBLIC_SITE_URL}/?url=${encodeURIComponent(normalizeReviewUrl(activeAddress) || DEFAULT_REVIEW_URL)}`;

  return (
    <main className="review-shell">
      <header className="topbar">
        <button className="brand" type="button" aria-label="Pinpoint home" onClick={() => window.location.reload()}>
          <span className="brand-mark">p</span>
          <span>pinpoint</span>
        </button>
        <div className="review-title">
          <strong>Kanso Studio</strong>
          <span>Homepage review</span>
        </div>
        <div className="topbar-actions">
          <span className="saved-state"><i /> {saving ? "Saving…" : "Saved"}</span>
          <button className="comments-toggle" type="button" onClick={() => setPanelOpen((open) => !open)}>
            {openCount} comments
          </button>
          <button className="share-button" type="button" onClick={() => setShareOpen(true)}>Share review</button>
        </div>
      </header>

      <section className={`review-layout ${panelOpen ? "panel-is-open" : ""}`}>
        <nav className="toolrail" aria-label="Review tools">
          <button
            className={`tool ${mode === "comment" ? "active" : ""}`}
            type="button"
            aria-label="Comment tool"
            aria-pressed={mode === "comment"}
            onClick={() => setMode("comment")}
          >+</button>
          <button
            className={`tool ${mode === "navigate" ? "active" : ""}`}
            type="button"
            aria-label="Navigate tool"
            aria-pressed={mode === "navigate"}
            onClick={() => setMode("navigate")}
          >↗</button>
          <button className="tool" type="button" aria-label="Toggle comments" onClick={() => setPanelOpen((open) => !open)}>☷</button>
          <span className="tool-spacer" />
          <button className="tool" type="button" aria-label="Keyboard shortcuts" onClick={() => setToast("Tip: press a pin to jump to its feedback")}>?</button>
        </nav>

        <div className="canvas-wrap">
          <div className="mode-pill"><span>●</span>{mode === "comment" ? "Click anywhere to comment" : "Navigate mode"}</div>
          <article className="browser-frame" aria-label="Website under review">
            <div className="browser-bar">
              <div className="traffic"><i /><i /><i /></div>
              <form className="address" onSubmit={loadAddress}>
                <label className="sr-only" htmlFor="review-url">Website URL</label>
                <input id="review-url" value={address} onChange={(event) => setAddress(event.target.value)} />
                <button type="submit" aria-label="Load website">↵</button>
              </form>
              <a className="open-icon" href={activeAddress} target="_blank" rel="noreferrer" aria-label="Open original website">↗</a>
            </div>
            <div className={`sample-site ${mode === "comment" ? "comment-cursor" : ""}`} onClick={placeComment} ref={canvasRef}>
              <nav className="sample-nav">
                <span className="sample-logo">KANSO</span>
                <div><span>Studio</span><span>Projects</span><span>Contact</span></div>
              </nav>
              <div className="sample-hero">
                <p>Independent creative studio · Copenhagen</p>
                <h1>We shape quiet ideas<br />into bold identities.</h1>
                <div className="sample-cta">Explore our work <span>↘</span></div>
              </div>
              <div className="sample-art" aria-hidden="true">
                <div className="art-orb" />
                <div className="art-card">A new perspective<br />on the familiar.</div>
              </div>
              <div className="site-label">Reviewing <strong>{displayHost}</strong></div>

              {comments.map((comment, index) => (
                <button
                  className={`pin ${selectedId === comment.id ? "selected" : ""} ${comment.status === "resolved" ? "resolved" : ""}`}
                  style={{ left: `${comment.x}%`, top: `${comment.y}%` }}
                  type="button"
                  key={comment.id}
                  aria-label={`Open comment ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(comment.id);
                    setPanelOpen(true);
                    setFilter(comment.status);
                  }}
                ><span>{index + 1}</span></button>
              ))}

              {draftPoint && (
                <form
                  className={`pin-composer ${draftPoint.x > 63 ? "opens-left" : ""} ${draftPoint.y > 62 ? "opens-up" : ""}`}
                  style={{ left: `${draftPoint.x}%`, top: `${draftPoint.y}%` }}
                  onSubmit={submitComment}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="composer-top"><strong>Leave feedback</strong><button type="button" aria-label="Cancel comment" onClick={() => setDraftPoint(null)}>×</button></div>
                  <input aria-label="Your name" placeholder="Your name (optional)" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={60} />
                  <textarea aria-label="Feedback" placeholder="What should change?" value={body} onChange={(event) => setBody(event.target.value)} maxLength={800} required />
                  <div className="composer-actions"><span>{body.length}/800</span><button type="submit" disabled={!body.trim() || saving}>{saving ? "Saving…" : "Comment"}</button></div>
                </form>
              )}
            </div>
          </article>
          <p className="canvas-note">Add <strong>{displayHost}</strong>, place feedback, then share one clean review link.</p>
        </div>

        <aside className={`comment-panel ${panelOpen ? "open" : ""}`} aria-label="Feedback panel">
          <div className="panel-head">
            <div><h2>Feedback</h2><span>{openCount} open {openCount === 1 ? "comment" : "comments"}</span></div>
            <button type="button" aria-label="Close feedback" onClick={() => setPanelOpen(false)}>×</button>
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Comment status">
            <button role="tab" aria-selected={filter === "open"} className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Open <span>{openCount}</span></button>
            <button role="tab" aria-selected={filter === "resolved"} className={filter === "resolved" ? "active" : ""} onClick={() => setFilter("resolved")}>Resolved <span>{comments.length - openCount}</span></button>
          </div>
          <div className="comment-list">
            {visibleComments.length === 0 ? (
              <div className="empty-comments"><b>All clear</b><span>{filter === "open" ? "Click the page to add feedback." : "Resolved comments will appear here."}</span></div>
            ) : visibleComments.map((comment) => {
              const number = comments.findIndex((item) => item.id === comment.id) + 1;
              return (
                <article className={`comment-card ${selectedId === comment.id ? "selected" : ""}`} key={comment.id} onClick={() => setSelectedId(comment.id)}>
                  <div className="comment-number">{number}</div>
                  <div className="comment-copy">
                    <strong>{comment.author}</strong><time>{formatTime(comment.createdAt)}</time>
                    <p>{comment.body}</p>
                    <button type="button" onClick={(event) => { event.stopPropagation(); toggleResolved(comment); }}>
                      {comment.status === "open" ? "✓ Resolve" : "↶ Reopen"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <button className="comment-compose" type="button" onClick={() => { setMode("comment"); setPanelOpen(false); }}>
            <span>＋</span><b>Add feedback on the page</b>
          </button>
        </aside>
      </section>

      {shareOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShareOpen(false)}>
          <section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close share dialog" onClick={() => setShareOpen(false)}>×</button>
            <div className="share-icon">↗</div>
            <p className="eyebrow">Ready for review</p>
            <h2 id="share-title">Send one link.<br />Keep every note in context.</h2>
            <p>Public reviews open in any browser and accept feedback without an account. Protected reviews ask for a matching Zero account.</p>
            <div className="share-link-row">
              <span>{shareLink}</span>
              <button type="button" onClick={copyShareLink}>Copy link</button>
            </div>
            <a className="zero-link" href={shareLink} target="_blank" rel="noreferrer">
              <span className="zero-badge">0</span>
              <span><strong>Public browser review</strong><small>Open without installing the extension</small></span>
              <b>↗</b>
            </a>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </main>
  );
}
