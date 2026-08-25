(() => {
  const API_ROOT = location.origin;
  const ARCHIVE_CHANNEL = "pinpoint-archive-v1";
  const EXTENSION_CHANNEL = "pinpoint-extension-v1";
  const DEFAULT_URL = "https://kanso.studio/";
  const $ = (selector) => document.querySelector(selector);
  const state = {
    pageUrl: reviewUrl(), captureId: reviewCapture(), artifact: null, snapshotUrl: "", archiveReady: false,
    comments: [], filter: "open", mode: "comment", selectedId: null, draft: null, extensionBridge: false,
  };
  const extensionRequests = new Map();

  addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== EXTENSION_CHANNEL) return;
    if (event.data.type === "ready") {
      const wasReady = state.extensionBridge;
      state.extensionBridge = true;
      if (!wasReady) loadComments();
      return;
    }
    if (event.data.type !== "response") return;
    const pending = extensionRequests.get(event.data.requestId);
    if (!pending) return;
    extensionRequests.delete(event.data.requestId);
    clearTimeout(pending.timeout);
    if (event.data.ok) pending.resolve(event.data.data);
    else pending.reject(new Error(event.data.error || "The extension could not complete that action."));
  });
  postMessage({ channel: EXTENSION_CHANNEL, type: "ping" }, location.origin);

  function extensionRequest(type, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => { extensionRequests.delete(requestId); reject(new Error("The signed-in extension is unavailable.")); }, 1200);
      extensionRequests.set(requestId, { resolve, reject, timeout });
      postMessage({ channel: EXTENSION_CHANNEL, type: "request", requestId, requestType: type, payload }, location.origin);
    });
  }

  async function commentsRequest(method, payload = null) {
    const requestType = method === "GET" ? "COMMENTS_LIST" : method === "POST" ? "COMMENTS_CREATE" : "COMMENTS_UPDATE";
    if (state.extensionBridge) {
      try {
        return await extensionRequest(requestType, method === "GET" ? { pageUrl: state.pageUrl, captureId: state.captureId } : { comment: payload });
      } catch (error) {
        if (method === "PATCH" && Object.hasOwn(payload || {}, "body")) throw error;
      }
    }
    const response = await fetch(method === "GET" ? api("/api/comments") : new URL("/api/comments", API_ROOT), {
      method,
      ...(payload ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to update feedback");
    return data;
  }

  function cleanUrl(value) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!/^https?:$/.test(url.protocol)) return null;
      url.hash = "";
      return url.toString();
    } catch { return null; }
  }
  function reviewUrl() { return cleanUrl(new URLSearchParams(location.search).get("url") || "") || DEFAULT_URL; }
  function reviewCapture() { const value = new URLSearchParams(location.search).get("capture"); return value && /^[a-zA-Z0-9-]{1,80}$/.test(value) ? value : null; }
  function host() { try { return new URL(state.pageUrl).hostname; } catch { return state.pageUrl; } }
  function api(path, includeCapture = true) { const url = new URL(path, API_ROOT); url.searchParams.set("url", state.pageUrl); if (includeCapture && state.captureId) url.searchParams.set("capture", state.captureId); return url; }
  function toast(message, error = false) { const node = $("#toast"); node.textContent = message; node.classList.toggle("error", error); node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 2800); }
  function formatTime(value) { const date = new Date(value); const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)); if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes} min`; if (minutes < 1440) return `${Math.floor(minutes / 60)} hr`; return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }
  function isArchive() { return state.artifact?.artifactType === "archive"; }
  function setPanel(open) { $("#review-layout").classList.toggle("panel-is-open", open); $("#comment-panel").classList.toggle("open", open); }
  function postArchive(type, payload = {}) {
    if (!isArchive()) return;
    $("#review-archive").contentWindow?.postMessage({ channel: ARCHIVE_CHANNEL, type, ...payload }, "*");
  }

  function setMode(mode) {
    state.mode = mode;
    $("#comment-tool").classList.toggle("active", mode === "comment");
    $("#navigate-tool").classList.toggle("active", mode === "navigate");
    $("#comment-tool").setAttribute("aria-pressed", String(mode === "comment"));
    $("#navigate-tool").setAttribute("aria-pressed", String(mode === "navigate"));
    $("#capture-surface").classList.toggle("comment-cursor", mode === "comment" && Boolean(state.snapshotUrl));
    postArchive("mode", { mode });
    updateModeCopy();
  }
  function updateModeCopy() {
    const copy = $("#mode-copy");
    if (isArchive()) copy.textContent = state.mode === "comment" ? "Click the interactive page to comment" : "Scroll and select the archived page";
    else if (state.snapshotUrl) copy.textContent = state.mode === "comment" ? "Click the image fallback to comment" : "Scroll through the image fallback";
    else copy.textContent = "No shared website revision";
  }

  async function load() {
    closeComposer();
    state.pageUrl = reviewUrl();
    state.captureId = reviewCapture();
    $("#review-url").value = state.pageUrl;
    $("#open-original").href = state.pageUrl;
    $("#review-title").textContent = host();
    $("#canvas-note").innerHTML = `Loading the shared revision for <strong>${escapeHtml(host())}</strong>…`;
    await loadArtifact();
    await loadComments();
  }

  function resetArtifactView() {
    if (state.snapshotUrl) URL.revokeObjectURL(state.snapshotUrl);
    state.snapshotUrl = "";
    state.artifact = null;
    state.archiveReady = false;
    $("#review-archive").removeAttribute("src");
    $("#archive-surface").hidden = true;
    $("#capture-surface").hidden = true;
    $("#snapshot-empty").hidden = false;
    $("#snapshot-empty strong").textContent = "Loading this review…";
    $("#snapshot-empty p").textContent = "";
    $("#artifact-badge").textContent = "LOADING";
    $("#artifact-badge").classList.remove("fallback");
    $("#review-canvas").classList.remove("archive-mode");
  }

  async function loadArtifact() {
    resetArtifactView();
    $("#mode-copy").textContent = "Loading website revision…";
    try {
      const response = await fetch(api("/api/artifact"));
      const artifact = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(artifact.error || "Unable to open this website revision");
      state.artifact = artifact;
      state.captureId = artifact.captureId || state.captureId;
      if (state.captureId && reviewCapture() !== state.captureId) {
        const revisionUrl = new URL(location.href);
        revisionUrl.searchParams.set("capture", state.captureId);
        history.replaceState({}, "", revisionUrl);
      }
      $("#review-title").textContent = artifact.pageTitle || host();
      if (artifact.artifactType === "archive") await loadArchive();
      else await loadImageFallback();
    } catch (error) {
      $("#snapshot-empty strong").textContent = "No website revision yet";
      $("#snapshot-empty p").textContent = error.message || "Open this page with Pinpoint and press Share.";
      $("#canvas-note").innerHTML = `Open <strong>${escapeHtml(host())}</strong> with the Pinpoint extension, then press Share.`;
    }
    setMode(state.mode);
    renderPins();
  }

  async function loadArchive() {
    $("#snapshot-empty").hidden = true;
    $("#archive-surface").hidden = false;
    $("#review-canvas").classList.add("archive-mode");
    $("#artifact-badge").textContent = "LIVE DOM";
    $("#review-archive").src = api("/api/archive").toString();
    $("#canvas-note").innerHTML = `Interactive DOM revision from <strong>${escapeHtml(host())}</strong>. Text is selectable, scrolling is native, and pins stay attached to page elements.`;
  }

  async function loadImageFallback() {
    const response = await fetch(api("/api/snapshot"));
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "Unable to open the image fallback"); }
    state.snapshotUrl = URL.createObjectURL(await response.blob());
    const image = $("#review-snapshot");
    image.src = state.snapshotUrl;
    image.alt = `Image fallback of ${state.artifact.pageTitle || host()}`;
    $("#snapshot-empty").hidden = true;
    $("#capture-surface").hidden = false;
    $("#site-label strong").textContent = host();
    $("#artifact-badge").textContent = "IMAGE FALLBACK";
    $("#artifact-badge").classList.add("fallback");
    if (state.artifact.pageWidth && state.artifact.pageHeight) $("#capture-surface").style.aspectRatio = `${state.artifact.pageWidth} / ${state.artifact.pageHeight}`;
    $("#canvas-note").innerHTML = `This older immutable revision from <strong>${escapeHtml(host())}</strong> is an image fallback. Share again from the extension to publish an interactive DOM revision.`;
  }

  async function loadComments() {
    try {
      const data = await commentsRequest("GET");
      state.comments = data.comments || [];
    } catch (error) { state.comments = []; toast(error.message, true); }
    renderComments();
    renderPins();
  }

  function imagePoint(comment) {
    if (comment.positionAvailable === false) return null;
    const x = Number(comment.x); const y = Number(comment.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  function renderPins() {
    if (isArchive()) {
      postArchive("render", { comments: state.comments, selectedId: state.selectedId });
      return;
    }
    const root = $("#pins"); root.replaceChildren();
    if (!state.snapshotUrl) return;
    state.comments.forEach((comment, index) => {
      const point = imagePoint(comment); if (!point) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `pin${state.selectedId === comment.id ? " selected" : ""}${comment.status === "resolved" ? " resolved" : ""}`;
      button.dataset.commentId = String(comment.id);
      button.style.left = `${point.x}%`; button.style.top = `${point.y}%`;
      button.setAttribute("aria-label", `Open comment ${index + 1}`);
      button.innerHTML = `<span>${index + 1}</span>`;
      button.addEventListener("click", (event) => { event.stopPropagation(); selectComment(comment); });
      root.append(button);
    });
  }
  function selectComment(comment) {
    state.selectedId = comment.id;
    state.filter = comment.status;
    syncFilterTabs();
    setPanel(true);
    renderComments();
    renderPins();
  }
  function locateComment(comment) {
    selectComment(comment);
    if (isArchive()) return postArchive("locate", { id: comment.id });
    requestAnimationFrame(() => {
      const pin = document.querySelector(`.pin[data-comment-id="${comment.id}"]`);
      if (!pin) return toast("That comment could not be positioned on this revision.", true);
      pin.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      pin.classList.add("locating"); setTimeout(() => pin.classList.remove("locating"), 1300);
    });
  }
  function syncFilterTabs() {
    $("#open-tab").classList.toggle("active", state.filter === "open");
    $("#resolved-tab").classList.toggle("active", state.filter === "resolved");
    $("#open-tab").setAttribute("aria-selected", String(state.filter === "open"));
    $("#resolved-tab").setAttribute("aria-selected", String(state.filter === "resolved"));
  }
  function renderComments() {
    const open = state.comments.filter((item) => item.status === "open").length;
    $("#comments-toggle").textContent = `${state.comments.length} ${state.comments.length === 1 ? "comment" : "comments"}`;
    $("#open-summary").textContent = `${open} open ${open === 1 ? "comment" : "comments"}`;
    $("#open-tab span").textContent = open;
    $("#resolved-tab span").textContent = state.comments.length - open;
    const list = $("#comment-list"); list.replaceChildren();
    const visible = state.comments.filter((item) => item.status === state.filter);
    if (!visible.length) {
      list.innerHTML = `<div class="empty-comments"><b>All clear</b><span>${state.filter === "open" ? "Click the page to add feedback." : "Resolved comments will appear here."}</span></div>`;
      return;
    }
    visible.forEach((comment) => {
      const number = state.comments.findIndex((item) => item.id === comment.id) + 1;
      const card = document.createElement("article");
      card.className = `comment-card${state.selectedId === comment.id ? " selected" : ""}`;
      card.innerHTML = `<div class="comment-number">${number}</div><div class="comment-copy"><strong>${escapeHtml(comment.author)}</strong><time>${formatTime(comment.createdAt)}</time><p>${escapeHtml(comment.body)}</p><div class="comment-actions"><button type="button" data-action="status">${comment.status === "open" ? "✓ Resolve" : "↶ Reopen"}</button>${comment.canEdit ? '<button type="button" data-action="edit">Edit</button>' : ""}</div></div>`;
      card.addEventListener("click", () => locateComment(comment));
      card.querySelector('[data-action="status"]').addEventListener("click", (event) => { event.stopPropagation(); toggleResolved(comment); });
      card.querySelector('[data-action="edit"]')?.addEventListener("click", (event) => { event.stopPropagation(); beginEditComment(comment, card); });
      list.append(card);
    });
  }
  function beginEditComment(comment, card) {
    const copy = card.querySelector(".comment-copy");
    copy.querySelector("p").hidden = true;
    copy.querySelector(".comment-actions").hidden = true;
    const form = document.createElement("form");
    form.className = "comment-edit-form";
    form.innerHTML = `<textarea maxlength="800" aria-label="Edit comment" required>${escapeHtml(comment.body)}</textarea><div><button type="button">Cancel</button><button type="submit">Save edit</button></div>`;
    form.addEventListener("click", (event) => event.stopPropagation());
    form.querySelector('button[type="button"]').addEventListener("click", () => renderComments());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = form.querySelector("textarea").value.trim();
      if (!body || body === comment.body) return renderComments();
      const submit = form.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = "Saving…";
      try {
        const data = await commentsRequest("PATCH", { id: comment.id, body, pageUrl: state.pageUrl });
        comment.body = data.comment?.body || body;
        renderComments(); renderPins(); toast("Comment updated");
      } catch (error) { submit.disabled = false; submit.textContent = "Save edit"; toast(error.message, true); }
    });
    copy.append(form);
    requestAnimationFrame(() => form.querySelector("textarea").focus());
  }
  async function toggleResolved(comment) {
    const status = comment.status === "open" ? "resolved" : "open";
    try {
      await commentsRequest("PATCH", { id: comment.id, status, pageUrl: state.pageUrl });
      comment.status = status; state.filter = status; syncFilterTabs(); renderComments(); renderPins(); toast(status === "resolved" ? "Marked resolved" : "Reopened");
    } catch (error) { toast(error.message, true); }
  }

  function beginImageComment(event) {
    if (state.mode !== "comment" || !state.snapshotUrl) return;
    const surface = $("#capture-surface").getBoundingClientRect();
    const x = ((event.clientX - surface.left) / surface.width) * 100;
    const y = ((event.clientY - surface.top) / surface.height) * 100;
    state.draft = { x, y, viewX: x, viewY: y, anchor: null };
    showComposer();
  }
  function showComposer() {
    const draft = state.draft; $(".pin-composer")?.remove(); if (!draft) return;
    const form = document.createElement("form");
    form.className = `pin-composer${draft.viewX > 63 ? " opens-left" : ""}${draft.viewY > 62 ? " opens-up" : ""}`;
    form.style.left = `${draft.viewX}%`; form.style.top = `${draft.viewY}%`;
    form.innerHTML = `<div class="composer-top"><strong>Leave feedback</strong><button type="button" aria-label="Cancel comment">×</button></div><input aria-label="Your name" maxlength="60" placeholder="Your name (optional)"><textarea aria-label="Feedback" maxlength="800" placeholder="What should change?" required></textarea><div class="composer-actions"><span>Public guest feedback</span><button type="submit">Comment</button></div>`;
    form.addEventListener("click", (event) => event.stopPropagation());
    form.querySelector(".composer-top button").addEventListener("click", closeComposer);
    form.addEventListener("submit", submitComment);
    (isArchive() ? $("#archive-surface") : $("#capture-surface")).append(form);
    requestAnimationFrame(() => form.querySelector("textarea").focus());
  }
  function closeComposer() { $(".pin-composer")?.remove(); state.draft = null; }
  async function submitComment(event) {
    event.preventDefault(); const form = event.currentTarget; const body = form.querySelector("textarea").value.trim(); if (!body || !state.draft) return;
    const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Saving…";
    try {
      const payload = {
        author: form.querySelector("input").value.trim() || "Guest reviewer", body,
        x: Number(state.draft.x.toFixed(2)), y: Number(state.draft.y.toFixed(2)), anchor: state.draft.anchor || null,
        status: "open", pageUrl: state.pageUrl, pageTitle: state.artifact?.pageTitle || `${host()} review`, captureId: state.captureId,
      };
      const data = await commentsRequest("POST", payload);
      state.comments.push(data.comment); state.selectedId = data.comment.id; closeComposer(); renderComments(); renderPins(); setPanel(true); toast("Comment saved");
    } catch (error) { button.disabled = false; button.textContent = "Comment"; toast(error.message, true); }
  }

  addEventListener("message", (event) => {
    const frame = $("#review-archive");
    if (event.source !== frame.contentWindow || event.data?.channel !== ARCHIVE_CHANNEL) return;
    if (event.data.type === "ready") {
      state.archiveReady = true;
      postArchive("mode", { mode: state.mode });
      renderPins();
    }
    if (event.data.type === "draft" && state.mode === "comment") {
      state.draft = { x: Number(event.data.x), y: Number(event.data.y), viewX: Number(event.data.viewX), viewY: Number(event.data.viewY), anchor: event.data.anchor || null };
      showComposer();
    }
    if (event.data.type === "select") {
      const comment = state.comments.find((item) => item.id === Number(event.data.id));
      if (comment) selectComment(comment);
    }
  });

  $("#address-form").addEventListener("submit", (event) => { event.preventDefault(); const url = cleanUrl($("#review-url").value); if (!url) return toast("Enter a valid website URL", true); const next = new URL(location.href); next.search = ""; next.searchParams.set("url", url); history.pushState({}, "", next); load(); });
  $("#capture-surface").addEventListener("click", (event) => { if (event.target.closest("button,input,textarea,form,a")) return; beginImageComment(event); });
  $("#comment-tool").addEventListener("click", () => setMode("comment"));
  $("#navigate-tool").addEventListener("click", () => setMode("navigate"));
  $("#comments-toggle").addEventListener("click", () => setPanel(!$("#comment-panel").classList.contains("open")));
  $("#panel-tool").addEventListener("click", () => setPanel(!$("#comment-panel").classList.contains("open")));
  $("#panel-close").addEventListener("click", () => setPanel(false));
  $("#open-tab").addEventListener("click", () => { state.filter = "open"; syncFilterTabs(); renderComments(); });
  $("#resolved-tab").addEventListener("click", () => { state.filter = "resolved"; syncFilterTabs(); renderComments(); });
  $("#compose-button").addEventListener("click", () => { setMode("comment"); setPanel(false); toast(isArchive() ? "Click the interactive page where the change belongs" : "Click the image fallback where the change belongs"); });
  $("#help-tool").addEventListener("click", () => toast(isArchive() ? "This is selectable archived HTML—not a screenshot" : "This older revision is using the image fallback"));
  $("#share-review").addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); toast("Public Zero-hosted review link copied"); } catch { toast("Copy the URL from your browser", true); } });
  addEventListener("popstate", load);
  load();
})();
