(() => {
  if (window.top !== window || document.querySelector("pinpoint-feedback-root")) return;

  const host = document.createElement("pinpoint-feedback-root");
  const shadow = host.attachShadow({ mode: "closed" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content.css");
  shadow.append(stylesheet);

  const shell = document.createElement("div");
  shell.className = "pp-shell";
  shell.hidden = true;
  shell.innerHTML = `
    <div class="pp-toolbar" role="toolbar" aria-label="Pinpoint feedback tools">
      <span class="pp-logo"><b>p</b><i>pinpoint</i></span>
      <span class="pp-divider"></span>
      <button class="pp-tool pp-comment-mode is-active" type="button" aria-pressed="true"><span>＋</span> Comment</button>
      <button class="pp-tool pp-panel-toggle" type="button"><span>☰</span> Feedback <em class="pp-count">0</em></button>
      <button class="pp-close" type="button" aria-label="Hide Pinpoint">×</button>
    </div>
    <div class="pp-pins" aria-live="polite"></div>
    <aside class="pp-panel" aria-label="Feedback panel" hidden>
      <header><div><span>PAGE FEEDBACK</span><h2></h2></div><button class="pp-panel-close" type="button" aria-label="Close panel">×</button></header>
      <nav aria-label="Feedback status">
        <button type="button" data-filter="open" class="is-active">Open <b>0</b></button>
        <button type="button" data-filter="resolved">Resolved <b>0</b></button>
        <button type="button" data-filter="all">All <b>0</b></button>
      </nav>
      <div class="pp-list"></div>
      <footer><span><i></i> Synced with Zero</span><button class="pp-refresh" type="button">Refresh</button></footer>
    </aside>
    <div class="pp-composer" role="dialog" aria-label="Add feedback" hidden>
      <div class="pp-composer-head"><span class="pp-avatar">0</span><div><strong>New feedback</strong><small></small></div><button class="pp-composer-close" type="button" aria-label="Cancel">×</button></div>
      <textarea maxlength="800" rows="4" placeholder="What should change here?"></textarea>
      <div class="pp-composer-actions"><span><kbd>⌘</kbd><kbd>↵</kbd> to post</span><button class="pp-cancel" type="button">Cancel</button><button class="pp-submit" type="button">Post feedback</button></div>
    </div>
    <div class="pp-toast" role="status" hidden></div>
  `;
  shadow.append(shell);
  document.documentElement.append(host);

  const $ = (selector) => shadow.querySelector(selector);
  const pinsElement = $(".pp-pins");
  const panel = $(".pp-panel");
  const list = $(".pp-list");
  const composer = $(".pp-composer");
  const textarea = composer.querySelector("textarea");
  const state = {
    active: false,
    commentMode: true,
    filter: "open",
    comments: [],
    point: null,
    pageUrl: normalizedPageUrl(),
    settings: {},
  };

  function normalizedPageUrl() {
    const url = new URL(location.href);
    url.hash = "";
    return url.toString();
  }

  function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || "Pinpoint could not complete that action."));
        resolve(response.data);
      });
    });
  }

  function toast(message, error = false) {
    const element = $(".pp-toast");
    element.textContent = message;
    element.classList.toggle("is-error", error);
    element.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { element.hidden = true; }, 3000);
  }

  function initials(name) {
    return (name || "Zero reviewer").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "just now";
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function pageDimensions() {
    const root = document.documentElement;
    const body = document.body;
    return {
      width: Math.max(root.scrollWidth, root.clientWidth, body?.scrollWidth || 0),
      height: Math.max(root.scrollHeight, root.clientHeight, body?.scrollHeight || 0),
    };
  }

  function positionPins() {
    const { width, height } = pageDimensions();
    pinsElement.querySelectorAll(".pp-pin").forEach((pin) => {
      const comment = state.comments.find((item) => String(item.id) === pin.dataset.id);
      if (!comment) return;
      pin.style.left = `${(comment.x / 100) * width - window.scrollX}px`;
      pin.style.top = `${(comment.y / 100) * height - window.scrollY}px`;
    });
  }

  function renderPins() {
    pinsElement.replaceChildren();
    state.comments.forEach((comment, index) => {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = `pp-pin${comment.status === "resolved" ? " is-resolved" : ""}`;
      pin.dataset.id = String(comment.id);
      pin.textContent = String(index + 1);
      pin.title = `${comment.author}: ${comment.body}`;
      pin.addEventListener("click", () => {
        state.filter = comment.status;
        panel.hidden = false;
        renderPanel();
        requestAnimationFrame(() => list.querySelector(`[data-id="${comment.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      });
      pinsElement.append(pin);
    });
    positionPins();
  }

  function buildEmptyState() {
    const empty = document.createElement("div");
    empty.className = "pp-empty";
    const icon = document.createElement("span");
    icon.textContent = state.filter === "resolved" ? "✓" : "＋";
    const title = document.createElement("strong");
    title.textContent = state.filter === "resolved" ? "Nothing resolved yet" : "No feedback here yet";
    const copy = document.createElement("p");
    copy.textContent = state.filter === "resolved" ? "Resolved notes will collect here." : "Click anywhere on the page to place the first pin.";
    empty.append(icon, title, copy);
    return empty;
  }

  function buildCommentCard(comment, index) {
    const card = document.createElement("article");
    card.className = `pp-card${comment.status === "resolved" ? " is-resolved" : ""}`;
    card.dataset.id = String(comment.id);

    const top = document.createElement("div");
    top.className = "pp-card-top";
    const avatar = document.createElement("span");
    avatar.className = "pp-card-avatar";
    avatar.textContent = initials(comment.author);
    const meta = document.createElement("div");
    const author = document.createElement("strong");
    author.textContent = comment.author;
    const time = document.createElement("small");
    time.textContent = formatDate(comment.createdAt);
    meta.append(author, time);
    const number = document.createElement("b");
    number.className = "pp-card-number";
    number.textContent = String(index + 1);
    top.append(avatar, meta, number);

    const body = document.createElement("p");
    body.textContent = comment.body;
    const actions = document.createElement("div");
    actions.className = "pp-card-actions";
    const locate = document.createElement("button");
    locate.type = "button";
    locate.textContent = "Locate on page";
    locate.addEventListener("click", () => {
      const { height } = pageDimensions();
      window.scrollTo({ top: Math.max(0, (comment.y / 100) * height - window.innerHeight / 2), behavior: "smooth" });
      const pin = pinsElement.querySelector(`[data-id="${comment.id}"]`);
      pin?.classList.add("is-pulsing");
      setTimeout(() => pin?.classList.remove("is-pulsing"), 1200);
    });
    const resolve = document.createElement("button");
    resolve.type = "button";
    resolve.className = "pp-resolve";
    resolve.textContent = comment.status === "resolved" ? "Reopen" : "Resolve";
    resolve.addEventListener("click", () => updateStatus(comment));
    actions.append(locate, resolve);
    card.append(top, body, actions);
    return card;
  }

  function renderPanel() {
    $(".pp-panel h2").textContent = document.title || new URL(state.pageUrl).hostname;
    const counts = {
      all: state.comments.length,
      open: state.comments.filter((comment) => comment.status === "open").length,
      resolved: state.comments.filter((comment) => comment.status === "resolved").length,
    };
    $(".pp-count").textContent = String(counts.open);
    panel.querySelectorAll("nav button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.filter === state.filter);
      button.querySelector("b").textContent = String(counts[button.dataset.filter]);
    });
    const visible = state.filter === "all" ? state.comments : state.comments.filter((comment) => comment.status === state.filter);
    list.replaceChildren();
    if (!visible.length) list.append(buildEmptyState());
    visible.forEach((comment) => list.append(buildCommentCard(comment, state.comments.indexOf(comment))));
  }

  async function loadComments(showConfirmation = false) {
    try {
      const result = await send("COMMENTS_LIST", { pageUrl: state.pageUrl });
      state.comments = result.comments || [];
      renderPins();
      renderPanel();
      if (showConfirmation) toast("Feedback refreshed");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function updateStatus(comment) {
    const next = comment.status === "open" ? "resolved" : "open";
    try {
      await send("COMMENTS_UPDATE", { comment: { id: comment.id, status: next, pageUrl: state.pageUrl } });
      comment.status = next;
      renderPins();
      renderPanel();
      toast(next === "resolved" ? "Feedback resolved" : "Feedback reopened");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function closeComposer() {
    composer.hidden = true;
    textarea.value = "";
    state.point = null;
  }

  function openComposer(clientX, clientY) {
    const { width, height } = pageDimensions();
    state.point = {
      x: Math.max(0, Math.min(100, ((clientX + window.scrollX) / width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY + window.scrollY) / height) * 100)),
    };
    composer.hidden = false;
    composer.style.left = `${Math.min(Math.max(12, clientX + 18), window.innerWidth - 350)}px`;
    composer.style.top = `${Math.min(Math.max(72, clientY - 20), window.innerHeight - 250)}px`;
    composer.querySelector("small").textContent = state.settings.displayName || "Zero reviewer";
    requestAnimationFrame(() => textarea.focus());
  }

  async function postComment() {
    const body = textarea.value.trim();
    if (!body || !state.point) return textarea.focus();
    const submit = $(".pp-submit");
    submit.disabled = true;
    try {
      const result = await send("COMMENTS_CREATE", {
        comment: {
          author: state.settings.displayName || "Zero reviewer",
          body,
          pageUrl: state.pageUrl,
          pageTitle: document.title || "Untitled page",
          ...state.point,
        },
      });
      state.comments.push(result.comment);
      closeComposer();
      state.filter = "open";
      panel.hidden = false;
      renderPins();
      renderPanel();
      toast("Feedback posted");
    } catch (error) {
      toast(error.message, true);
    } finally {
      submit.disabled = false;
    }
  }

  function handlePageClick(event) {
    if (!state.active || !state.commentMode || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.composedPath().includes(host)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openComposer(event.clientX, event.clientY);
  }

  function setCommentMode(enabled) {
    state.commentMode = enabled;
    const button = $(".pp-comment-mode");
    button.classList.toggle("is-active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    host.classList.toggle("is-targeting", enabled);
  }

  async function activate() {
    state.active = true;
    state.pageUrl = normalizedPageUrl();
    shell.hidden = false;
    setCommentMode(true);
    const auth = await send("ZERO_AUTH_STATUS").catch(() => null);
    state.settings = auth?.settings || {};
    if (!auth?.signedIn) toast("Open the Pinpoint extension and sign in with Zero.", true);
    else await loadComments();
  }

  function deactivate() {
    state.active = false;
    shell.hidden = true;
    panel.hidden = true;
    closeComposer();
    host.classList.remove("is-targeting");
  }

  $(".pp-comment-mode").addEventListener("click", () => setCommentMode(!state.commentMode));
  $(".pp-panel-toggle").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
  $(".pp-close").addEventListener("click", deactivate);
  $(".pp-panel-close").addEventListener("click", () => { panel.hidden = true; });
  $(".pp-composer-close").addEventListener("click", closeComposer);
  $(".pp-cancel").addEventListener("click", closeComposer);
  $(".pp-submit").addEventListener("click", postComment);
  $(".pp-refresh").addEventListener("click", () => loadComments(true));
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeComposer();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) postComment();
  });
  panel.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    renderPanel();
  }));

  document.addEventListener("click", handlePageClick, true);
  window.addEventListener("scroll", positionPins, { passive: true });
  window.addEventListener("resize", positionPins, { passive: true });
  setInterval(() => {
    const current = normalizedPageUrl();
    if (!state.active || current === state.pageUrl) return;
    state.pageUrl = current;
    state.comments = [];
    closeComposer();
    loadComments();
  }, 1200);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "PINPOINT_TOGGLE") return;
    const next = !state.active;
    (next ? activate() : Promise.resolve(deactivate()))
      .then(() => sendResponse({ ok: true, active: state.active }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
