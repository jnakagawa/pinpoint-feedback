(() => {
  const API_ROOT = "https://pinpoint-feedback.transqualia.chatgpt.site";
  const DEFAULT_URL = "https://kanso.studio/";
  const $ = (selector) => document.querySelector(selector);
  const state = { pageUrl: reviewUrl(), comments: [], snapshot: null, snapshotUrl: "", filter: "open", mode: "comment", selectedId: null, draft: null };

  function cleanUrl(value) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.toString();
    } catch { return null; }
  }
  function reviewUrl() { return cleanUrl(new URLSearchParams(location.search).get("url") || "") || DEFAULT_URL; }
  function host() { try { return new URL(state.pageUrl).hostname; } catch { return state.pageUrl; } }
  function api(path) { const url = new URL(path, API_ROOT); url.searchParams.set("url", state.pageUrl); return url; }
  function numberHeader(response, name) { const value = Number(response.headers.get(name)); return Number.isFinite(value) && value >= 0 ? value : 0; }
  function titleHeader(response) { const value = response.headers.get("x-page-title") || ""; try { return decodeURIComponent(value); } catch { return value; } }
  function toast(message, error = false) { const node = $("#toast"); node.textContent = message; node.classList.toggle("error", error); node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 2800); }
  function formatTime(value) { const date = new Date(value.endsWith?.("Z") ? value : `${value}Z`); const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)); if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes} min`; if (minutes < 1440) return `${Math.floor(minutes / 60)} hr`; return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function setPanel(open) { $("#review-layout").classList.toggle("panel-is-open", open); $("#comment-panel").classList.toggle("open", open); }
  function setMode(mode) { state.mode = mode; $("#comment-tool").classList.toggle("active", mode === "comment"); $("#navigate-tool").classList.toggle("active", mode === "navigate"); $("#comment-tool").setAttribute("aria-pressed", String(mode === "comment")); $("#navigate-tool").setAttribute("aria-pressed", String(mode === "navigate")); $("#review-canvas").classList.toggle("comment-cursor", mode === "comment" && Boolean(state.snapshotUrl)); updateModeCopy(); }
  function updateModeCopy() { $("#mode-copy").textContent = state.snapshotUrl ? (state.mode === "comment" ? "Click the captured page to comment" : "Navigate mode") : "No shared page capture"; }

  async function load() {
    state.pageUrl = reviewUrl();
    $("#review-url").value = state.pageUrl;
    $("#open-original").href = state.pageUrl;
    $("#review-title").textContent = host();
    $("#canvas-note").innerHTML = `Use Pinpoint on <strong>${escapeHtml(host())}</strong>, then press Share to publish its current view here.`;
    await Promise.all([loadComments(), loadSnapshot()]);
  }
  async function loadComments() {
    try {
      const response = await fetch(api("/api/comments"));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load feedback");
      state.comments = data.comments || [];
    } catch (error) { state.comments = []; toast(error.message, true); }
    renderComments(); renderPins();
  }
  async function loadSnapshot() {
    if (state.snapshotUrl) URL.revokeObjectURL(state.snapshotUrl);
    state.snapshot = null; state.snapshotUrl = "";
    $("#review-snapshot").hidden = true; $("#site-label").hidden = true;
    $("#snapshot-empty").hidden = false; $("#snapshot-empty strong").textContent = "Loading this review…"; $("#snapshot-empty p").textContent = "";
    $("#mode-copy").textContent = "Loading page capture…";
    try {
      const response = await fetch(api("/api/snapshot"));
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Unable to open this page capture"); }
      state.snapshot = { pageTitle: titleHeader(response), pageWidth: numberHeader(response, "x-page-width"), pageHeight: numberHeader(response, "x-page-height"), viewportWidth: numberHeader(response, "x-viewport-width"), viewportHeight: numberHeader(response, "x-viewport-height"), scrollX: numberHeader(response, "x-scroll-x"), scrollY: numberHeader(response, "x-scroll-y") };
      state.snapshotUrl = URL.createObjectURL(await response.blob());
      const image = $("#review-snapshot"); image.src = state.snapshotUrl; image.alt = `Captured view of ${state.snapshot.pageTitle || host()}`; image.hidden = false;
      $("#snapshot-empty").hidden = true; $("#site-label").hidden = false; $("#site-label strong").textContent = host();
      $("#review-title").textContent = state.snapshot.pageTitle || host();
      if (state.snapshot.viewportWidth && state.snapshot.viewportHeight) $("#review-canvas").style.aspectRatio = `${state.snapshot.viewportWidth} / ${state.snapshot.viewportHeight}`;
      $("#canvas-note").innerHTML = `Captured directly from <strong>${escapeHtml(host())}</strong>. Feedback stays aligned to the shared view.`;
    } catch (error) {
      $("#snapshot-empty strong").textContent = "No page capture yet";
      $("#snapshot-empty p").textContent = error.message || "Open this page with Pinpoint and press Share to capture the real website.";
    }
    setMode(state.mode); renderPins();
  }
  function snapshotPoint(comment) {
    const s = state.snapshot;
    if (!s?.pageWidth || !s.pageHeight || !s.viewportWidth || !s.viewportHeight) return null;
    const x = (((comment.x / 100) * s.pageWidth - s.scrollX) / s.viewportWidth) * 100;
    const y = (((comment.y / 100) * s.pageHeight - s.scrollY) / s.viewportHeight) * 100;
    return x >= 0 && x <= 100 && y >= 0 && y <= 100 ? { x, y } : null;
  }
  function renderPins() {
    const root = $("#pins"); root.replaceChildren();
    if (!state.snapshotUrl) return;
    state.comments.forEach((comment, index) => {
      const point = snapshotPoint(comment); if (!point) return;
      const button = document.createElement("button"); button.type = "button"; button.className = `pin${state.selectedId === comment.id ? " selected" : ""}${comment.status === "resolved" ? " resolved" : ""}`; button.style.left = `${point.x}%`; button.style.top = `${point.y}%`; button.setAttribute("aria-label", `Open comment ${index + 1}`); button.innerHTML = `<span>${index + 1}</span>`;
      button.addEventListener("click", (event) => { event.stopPropagation(); state.selectedId = comment.id; state.filter = comment.status; setPanel(true); renderComments(); renderPins(); }); root.append(button);
    });
  }
  function renderComments() {
    const open = state.comments.filter((item) => item.status === "open").length;
    $("#comments-toggle").textContent = `${state.comments.length} ${state.comments.length === 1 ? "comment" : "comments"}`;
    $("#open-summary").textContent = `${open} open ${open === 1 ? "comment" : "comments"}`;
    $("#open-tab span").textContent = open; $("#resolved-tab span").textContent = state.comments.length - open;
    const list = $("#comment-list"); list.replaceChildren();
    const visible = state.comments.filter((item) => item.status === state.filter);
    if (!visible.length) { list.innerHTML = `<div class="empty-comments"><b>All clear</b><span>${state.filter === "open" ? "Click the page to add feedback." : "Resolved comments will appear here."}</span></div>`; return; }
    visible.forEach((comment) => {
      const number = state.comments.findIndex((item) => item.id === comment.id) + 1;
      const card = document.createElement("article"); card.className = `comment-card${state.selectedId === comment.id ? " selected" : ""}`; card.innerHTML = `<div class="comment-number">${number}</div><div class="comment-copy"><strong>${escapeHtml(comment.author)}</strong><time>${formatTime(comment.createdAt)}</time><p>${escapeHtml(comment.body)}</p><button type="button">${comment.status === "open" ? "✓ Resolve" : "↶ Reopen"}</button></div>`;
      card.addEventListener("click", () => { state.selectedId = comment.id; renderComments(); renderPins(); }); card.querySelector("button").addEventListener("click", (event) => { event.stopPropagation(); toggleResolved(comment); }); list.append(card);
    });
  }
  async function toggleResolved(comment) {
    const status = comment.status === "open" ? "resolved" : "open";
    try {
      const response = await fetch(new URL("/api/comments", API_ROOT), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: comment.id, status, pageUrl: state.pageUrl }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Unable to update feedback"); comment.status = status; state.filter = status; renderComments(); renderPins(); toast(status === "resolved" ? "Marked resolved" : "Reopened");
    } catch (error) { toast(error.message, true); }
  }
  function beginComment(viewX, viewY) {
    const s = state.snapshot; if (state.mode !== "comment") return;
    if (!state.snapshotUrl || !s?.pageWidth || !s.pageHeight || !s.viewportWidth || !s.viewportHeight) return toast("Share a page capture from the Pinpoint extension first", true);
    const x = ((s.scrollX + (viewX / 100) * s.viewportWidth) / s.pageWidth) * 100; const y = ((s.scrollY + (viewY / 100) * s.viewportHeight) / s.pageHeight) * 100;
    state.draft = { x, y, viewX, viewY }; showComposer();
  }
  function showComposer() {
    closeComposer(); const draft = state.draft; if (!draft) return;
    const form = document.createElement("form"); form.className = `pin-composer${draft.viewX > 63 ? " opens-left" : ""}${draft.viewY > 62 ? " opens-up" : ""}`; form.style.left = `${draft.viewX}%`; form.style.top = `${draft.viewY}%`; form.innerHTML = `<div class="composer-top"><strong>Leave feedback</strong><button type="button" aria-label="Cancel comment">×</button></div><input aria-label="Your name" maxlength="60" placeholder="Your name (optional)"><textarea aria-label="Feedback" maxlength="800" placeholder="What should change?" required></textarea><div class="composer-actions"><span>Public guest feedback</span><button type="submit">Comment</button></div>`;
    form.addEventListener("click", (event) => event.stopPropagation()); form.querySelector(".composer-top button").addEventListener("click", closeComposer); form.addEventListener("submit", submitComment); $("#review-canvas").append(form); requestAnimationFrame(() => form.querySelector("textarea").focus());
  }
  function closeComposer() { $(".pin-composer")?.remove(); state.draft = null; }
  async function submitComment(event) {
    event.preventDefault(); const form = event.currentTarget; const body = form.querySelector("textarea").value.trim(); if (!body || !state.draft) return;
    const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Saving…";
    try {
      const response = await fetch(new URL("/api/comments", API_ROOT), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: form.querySelector("input").value.trim() || "Guest reviewer", body, x: Number(state.draft.x.toFixed(2)), y: Number(state.draft.y.toFixed(2)), status: "open", pageUrl: state.pageUrl, pageTitle: `${host()} review` }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Unable to save feedback"); state.comments.push(data.comment); state.selectedId = data.comment.id; closeComposer(); renderComments(); renderPins(); setPanel(true); toast("Comment saved");
    } catch (error) { button.disabled = false; button.textContent = "Comment"; toast(error.message, true); }
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }

  $("#address-form").addEventListener("submit", (event) => { event.preventDefault(); const url = cleanUrl($("#review-url").value); if (!url) return toast("Enter a valid website URL", true); const next = new URL(location.href); next.search = ""; next.searchParams.set("url", url); history.pushState({}, "", next); load(); });
  $("#review-canvas").addEventListener("click", (event) => { if (event.target.closest("button,input,textarea,form,a")) return; const rect = event.currentTarget.getBoundingClientRect(); beginComment(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100); });
  $("#review-canvas").addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key) && event.target === event.currentTarget) { event.preventDefault(); beginComment(50, 50); } });
  $("#comment-tool").addEventListener("click", () => setMode("comment")); $("#navigate-tool").addEventListener("click", () => setMode("navigate"));
  $("#comments-toggle").addEventListener("click", () => setPanel(!$("#comment-panel").classList.contains("open"))); $("#panel-tool").addEventListener("click", () => setPanel(!$("#comment-panel").classList.contains("open"))); $("#panel-close").addEventListener("click", () => setPanel(false));
  $("#open-tab").addEventListener("click", () => { state.filter = "open"; $("#open-tab").classList.add("active"); $("#resolved-tab").classList.remove("active"); renderComments(); }); $("#resolved-tab").addEventListener("click", () => { state.filter = "resolved"; $("#resolved-tab").classList.add("active"); $("#open-tab").classList.remove("active"); renderComments(); });
  $("#compose-button").addEventListener("click", () => { setMode("comment"); setPanel(false); toast("Click the captured page where the change belongs"); }); $("#help-tool").addEventListener("click", () => toast("Click the captured page to place a feedback pin"));
  $("#share-review").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); toast("Public Zero-hosted review link copied"); } catch { toast("Copy the URL from your browser", true); } });
  addEventListener("popstate", load); load();
})();
