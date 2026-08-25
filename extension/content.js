(() => {
  const PUBLIC_REVIEW_ROOT = "https://deploy-9po6nd1t-nlbndjpuja-uc.a.run.app/";
  const PUBLIC_REVIEW_ORIGIN = new URL(PUBLIC_REVIEW_ROOT).origin;
  const EXTENSION_CHANNEL = "pinpoint-extension-v1";

  if (location.origin === PUBLIC_REVIEW_ORIGIN) {
    const bridgeSend = (type, payload = {}) => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || "Pinpoint could not complete that action."));
        resolve(response.data);
      });
    });
    addEventListener("message", async (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== EXTENSION_CHANNEL) return;
      if (event.data.type === "ping") return postMessage({ channel: EXTENSION_CHANNEL, type: "ready" }, location.origin);
      if (event.data.type !== "request") return;
      const { requestId, requestType, payload = {} } = event.data;
      if (!["COMMENTS_LIST", "COMMENTS_CREATE", "COMMENTS_UPDATE"].includes(requestType)) return;
      try {
        const data = await bridgeSend(requestType, payload);
        postMessage({ channel: EXTENSION_CHANNEL, type: "response", requestId, ok: true, data }, location.origin);
      } catch (error) {
        postMessage({ channel: EXTENSION_CHANNEL, type: "response", requestId, ok: false, error: error.message }, location.origin);
      }
    });
    postMessage({ channel: EXTENSION_CHANNEL, type: "ready" }, location.origin);
  }

  if (window.top !== window || document.querySelector("pinpoint-feedback-root")) return;

  const host = document.createElement("pinpoint-feedback-root");
  host.dataset.pinpointVersion = chrome.runtime.getManifest().version;
  const shadow = host.attachShadow({ mode: "closed" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("content.css");
  shadow.append(stylesheet);
  const accessStylesheet = document.createElement("link");
  accessStylesheet.rel = "stylesheet";
  accessStylesheet.href = chrome.runtime.getURL("content-access.css");
  shadow.append(accessStylesheet);

  const shell = document.createElement("div");
  shell.className = "pp-shell";
  shell.hidden = true;
  shell.innerHTML = `
    <div class="pp-toolbar" role="toolbar" aria-label="Pinpoint feedback tools">
      <span class="pp-logo"><b>p</b><i>pinpoint</i></span>
      <span class="pp-divider"></span>
      <button class="pp-tool pp-comment-mode is-active" type="button" aria-pressed="true"><span>＋</span> Comment</button>
      <button class="pp-tool pp-panel-toggle" type="button"><span>☰</span> Feedback <em class="pp-count">0</em></button>
      <button class="pp-tool pp-share-review" type="button" title="Copy a browser link for this review"><span>↗</span> Share</button>
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
      <section class="pp-access" aria-label="Page protection">
        <div class="pp-access-row">
          <span class="pp-access-icon">◇</span>
          <div><strong>Checking page access…</strong><small>Zero email protection</small></div>
          <button class="pp-access-manage" type="button" hidden>Protect</button>
        </div>
        <form class="pp-access-form" hidden>
          <label for="pp-domain">Allow Zero accounts from</label>
          <div><span>@</span><input id="pp-domain" type="text" inputmode="url" autocomplete="off" maxlength="253" placeholder="studio.com"><button type="submit">Apply</button></div>
          <p>The domain must match the email on your Zero account.</p>
          <div class="pp-access-actions"><button class="pp-access-cancel" type="button">Cancel</button><button class="pp-access-remove" type="button" hidden>Remove restriction</button></div>
        </form>
      </section>
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
    access: null,
    currentCaptureId: null,
  };

  function normalizedPageUrl() {
    const url = new URL(location.href);
    url.hash = "";
    return url.toString();
  }

  function publicReviewUrl(captureId = state.currentCaptureId) {
    const url = new URL(PUBLIC_REVIEW_ROOT);
    url.searchParams.set("url", state.pageUrl);
    if (captureId) url.searchParams.set("capture", captureId);
    return url.toString();
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Some pages block the Clipboard API even when the click is user initiated.
      }
    }

    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
    shell.append(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    if (!copied) throw new Error("The review link could not be copied.");
  }

  async function shareReview() {
    const shareButton = $(".pp-share-review");
    const originalMarkup = shareButton.innerHTML;
    let usedExtensionFallback = false;
    try {
      shareButton.disabled = true;
      shareButton.innerHTML = "<span>◌</span> Publishing on Zero…";
      let published;
      try {
        published = await send("CAPTURE_PUBLISH", {
          capture: {
            pageUrl: state.pageUrl,
            pageTitle: document.title || new URL(state.pageUrl).hostname,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          },
        });
      } catch {
        usedExtensionFallback = true;
        shareButton.innerHTML = "<span>◌</span> Capturing private page…";
        shell.style.visibility = "hidden";
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const capture = await captureFullPageSnapshot((current, total) => {
          shareButton.innerHTML = `<span>◌</span> Capturing ${current}/${total}…`;
        });
        shareButton.innerHTML = "<span>↑</span> Publishing on Zero…";
        published = await send("SNAPSHOT_UPLOAD", {
          pageUrl: state.pageUrl,
          pageTitle: document.title || new URL(state.pageUrl).hostname,
          dataUrl: capture.dataUrl,
          metrics: capture.metrics,
        });
      }
      state.currentCaptureId = published.captureId || null;
      await copyText(publicReviewUrl(state.currentCaptureId));
      const protectedDomain = state.access?.allowedDomain;
      toast(protectedDomain
        ? `Revision published. Protected link copied — @${protectedDomain} Zero sign-in required.`
        : usedExtensionFallback
          ? "Private-page revision published on Zero. Public link copied."
          : "Fresh revision captured and published by Zero. Public link copied.");
    } catch (error) {
      toast(error.message, true);
    } finally {
      shell.style.visibility = "";
      shareButton.disabled = false;
      shareButton.innerHTML = originalMarkup;
    }
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

  function captureOffsets(total, viewport) {
    const max = Math.max(0, total - viewport);
    const offsets = [];
    for (let value = 0; value < max; value += viewport) offsets.push(value);
    offsets.push(max);
    return [...new Set(offsets.map((value) => Math.max(0, Math.round(value))))];
  }

  function waitForCapturePaint(delay = 180) {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, delay))));
  }

  function loadCaptureImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Pinpoint could not read a captured page segment."));
      image.src = dataUrl;
    });
  }

  function canvasJpeg(canvas, quality = 0.82) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Pinpoint could not assemble the full-page capture."));
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Pinpoint could not prepare the full-page capture."));
        reader.readAsDataURL(blob);
      }, "image/jpeg", quality);
    });
  }

  async function captureFullPageSnapshot(onProgress = () => {}) {
    const original = { x: window.scrollX, y: window.scrollY };
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootBehavior: root.style.scrollBehavior,
      rootSnap: root.style.scrollSnapType,
      bodyBehavior: body?.style.scrollBehavior || "",
      bodySnap: body?.style.scrollSnapType || "",
    };
    const initial = pageDimensions();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxPixels = 24_000_000;
    const maxDimension = 20_000;
    const scale = Math.min(
      1,
      Math.sqrt(maxPixels / Math.max(1, initial.width * initial.height)),
      maxDimension / Math.max(initial.width, initial.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(initial.width * scale));
    canvas.height = Math.max(1, Math.round(initial.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Pinpoint could not create a full-page capture.");
    context.fillStyle = getComputedStyle(root).backgroundColor || "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const xs = captureOffsets(initial.width, viewportWidth);
    const ys = captureOffsets(initial.height, viewportHeight);
    const total = xs.length * ys.length;
    let current = 0;
    root.style.scrollBehavior = "auto";
    root.style.scrollSnapType = "none";
    if (body) {
      body.style.scrollBehavior = "auto";
      body.style.scrollSnapType = "none";
    }

    try {
      for (const y of ys) {
        for (const x of xs) {
          window.scrollTo(x, y);
          await waitForCapturePaint(current ? 620 : 220);
          const actualX = window.scrollX;
          const actualY = window.scrollY;
          const result = await send("SNAPSHOT_VIEWPORT");
          const image = await loadCaptureImage(result.dataUrl);
          const visibleWidth = Math.min(viewportWidth, initial.width - actualX);
          const visibleHeight = Math.min(viewportHeight, initial.height - actualY);
          const sourceWidth = image.naturalWidth * (visibleWidth / viewportWidth);
          const sourceHeight = image.naturalHeight * (visibleHeight / viewportHeight);
          context.drawImage(
            image,
            0,
            0,
            sourceWidth,
            sourceHeight,
            actualX * scale,
            actualY * scale,
            visibleWidth * scale,
            visibleHeight * scale,
          );
          current += 1;
          onProgress(current, total);
        }
      }
    } finally {
      root.style.scrollBehavior = previous.rootBehavior;
      root.style.scrollSnapType = previous.rootSnap;
      if (body) {
        body.style.scrollBehavior = previous.bodyBehavior;
        body.style.scrollSnapType = previous.bodySnap;
      }
      window.scrollTo(original.x, original.y);
      await waitForCapturePaint(0);
    }

    return {
      dataUrl: await canvasJpeg(canvas),
      metrics: {
        pageWidth: initial.width,
        pageHeight: initial.height,
        viewportWidth: initial.width,
        viewportHeight: initial.height,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: scale,
      },
    };
  }

  function selectorEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function attributeEscape(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function elementText(element) {
    return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function stableSelector(element) {
    if (!(element instanceof Element)) return "";
    if (element.id) {
      const selector = `#${selectorEscape(element.id)}`;
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch { /* Continue. */ }
    }
    for (const name of ["data-testid", "data-test", "name", "aria-label"]) {
      const value = element.getAttribute(name);
      if (!value || value.length > 160) continue;
      const selector = `${element.localName}[${name}="${attributeEscape(value)}"]`;
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch { /* Continue. */ }
    }
    const parts = [];
    let current = element;
    for (let depth = 0; current && current !== document.documentElement && depth < 7; depth += 1) {
      const tag = current.localName;
      if (!tag) break;
      const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.localName === tag) : [];
      const part = siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag;
      parts.unshift(part);
      const selector = parts.join(" > ");
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch { /* Continue. */ }
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function buildDomAnchor(element, clientX, clientY) {
    if (!(element instanceof Element) || element === host || host.contains(element)) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      version: 1,
      selector: stableSelector(element),
      tag: element.localName || "",
      text: elementText(element),
      offsetX: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      offsetY: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }

  function resolveDomAnchor(anchor) {
    if (!anchor) return null;
    let element = null;
    if (anchor.selector) {
      try { element = document.querySelector(anchor.selector); } catch { element = null; }
    }
    if (!element && anchor.text) {
      const selector = /^[a-z0-9-]+$/.test(anchor.tag || "") ? anchor.tag : "body *";
      const wanted = String(anchor.text).replace(/\s+/g, " ").trim();
      try {
        element = [...document.querySelectorAll(selector)].slice(0, 1500).find((candidate) => {
          const text = elementText(candidate);
          return text === wanted || (wanted.length >= 24 && text.includes(wanted));
        }) || null;
      } catch { element = null; }
    }
    return element;
  }

  function commentClientPoint(comment) {
    const element = resolveDomAnchor(comment.anchor);
    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height) return {
        x: rect.left + rect.width * (Number(comment.anchor.offsetX) || 0),
        y: rect.top + rect.height * (Number(comment.anchor.offsetY) || 0),
        element,
      };
    }
    const { width, height } = pageDimensions();
    return {
      x: (comment.x / 100) * width - window.scrollX,
      y: (comment.y / 100) * height - window.scrollY,
      element: null,
    };
  }

  function positionPins() {
    pinsElement.querySelectorAll(".pp-pin").forEach((pin) => {
      const comment = state.comments.find((item) => String(item.id) === pin.dataset.id);
      if (!comment) return;
      const point = commentClientPoint(comment);
      pin.style.left = `${point.x}px`;
      pin.style.top = `${point.y}px`;
      pin.dataset.anchorMatched = String(Boolean(point.element));
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
      const target = resolveDomAnchor(comment.anchor);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      else {
        const { height } = pageDimensions();
        window.scrollTo({ top: Math.max(0, (comment.y / 100) * height - window.innerHeight / 2), behavior: "smooth" });
      }
      const pin = pinsElement.querySelector(`[data-id="${comment.id}"]`);
      pin?.classList.add("is-pulsing");
      setTimeout(() => pin?.classList.remove("is-pulsing"), 1200);
    });
    const resolve = document.createElement("button");
    resolve.type = "button";
    resolve.className = "pp-resolve";
    resolve.textContent = comment.status === "resolved" ? "Reopen" : "Resolve";
    resolve.addEventListener("click", () => updateStatus(comment));
    actions.append(locate);
    if (comment.canEdit) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "pp-edit";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => beginCommentEdit(comment, card, body, actions));
      actions.append(edit);
    }
    actions.append(resolve);
    card.append(top, body, actions);
    return card;
  }

  function beginCommentEdit(comment, card, bodyElement, actions) {
    bodyElement.hidden = true;
    actions.hidden = true;
    const form = document.createElement("form");
    form.className = "pp-edit-form";
    const input = document.createElement("textarea");
    input.maxLength = 800;
    input.required = true;
    input.value = comment.body;
    input.setAttribute("aria-label", "Edit comment");
    const controls = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save edit";
    controls.append(cancel, save);
    form.append(input, controls);
    cancel.addEventListener("click", renderPanel);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = input.value.trim();
      if (!body || body === comment.body) return renderPanel();
      save.disabled = true; save.textContent = "Saving…";
      try {
        const result = await send("COMMENTS_UPDATE", { comment: { id: comment.id, body, pageUrl: state.pageUrl } });
        comment.body = result.comment?.body || body;
        renderPins(); renderPanel(); toast("Comment updated");
      } catch (error) {
        save.disabled = false; save.textContent = "Save edit"; toast(error.message, true);
      }
    });
    card.append(form);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
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
    renderAccess();
  }

  function renderAccess() {
    const access = state.access;
    const section = $(".pp-access");
    const icon = section.querySelector(".pp-access-icon");
    const title = section.querySelector("strong");
    const copy = section.querySelector("small");
    const manage = section.querySelector(".pp-access-manage");
    const remove = section.querySelector(".pp-access-remove");
    const commentButton = $(".pp-comment-mode");
    if (!access) {
      title.textContent = "Checking page access…";
      copy.textContent = "Zero email protection";
      manage.hidden = true;
      return;
    }

    section.classList.toggle("is-protected", Boolean(access.allowedDomain));
    section.classList.toggle("is-denied", !access.hasAccess);
    icon.textContent = access.allowedDomain ? "◆" : "◇";
    if (!access.allowedDomain) {
      title.textContent = "Anyone with the public link can collaborate";
      copy.textContent = access.emailDomain
        ? `Optional: restrict this page to @${access.emailDomain}`
        : "Guests do not need Zero or the extension";
    } else {
      title.textContent = `Restricted to @${access.allowedDomain}`;
      copy.textContent = access.hasAccess
        ? "Your Zero account matches this domain"
        : "Use a matching Zero account to see or edit feedback";
    }
    manage.textContent = access.allowedDomain ? "Manage" : "Protect";
    manage.hidden = !access.canManage;
    remove.hidden = !access.allowedDomain;
    commentButton.disabled = !access.hasAccess;
  }

  async function loadAccess() {
    const result = await send("ACCESS_GET", { pageUrl: state.pageUrl });
    state.access = result.access;
    renderAccess();
    return result.access;
  }

  async function loadComments(showConfirmation = false) {
    try {
      const access = await loadAccess();
      if (!access.hasAccess) {
        state.comments = [];
        setCommentMode(false);
        renderPins();
        renderPanel();
        panel.hidden = false;
        toast(`This page is restricted to @${access.allowedDomain}.`, true);
        return;
      }
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

  function openComposer(clientX, clientY, target) {
    if (state.access && !state.access.hasAccess) {
      toast(`Use a Zero account with an @${state.access.allowedDomain} email.`, true);
      return;
    }
    const { width, height } = pageDimensions();
    state.point = {
      x: Math.max(0, Math.min(100, ((clientX + window.scrollX) / width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY + window.scrollY) / height) * 100)),
      anchor: buildDomAnchor(target, clientX, clientY),
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
    openComposer(event.clientX, event.clientY, event.target);
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

  async function saveProtection(allowedDomain) {
    try {
      const result = await send("ACCESS_UPDATE", {
        access: { pageUrl: state.pageUrl, allowedDomain },
      });
      state.access = result.access;
      $(".pp-access-form").hidden = true;
      renderAccess();
      toast(allowedDomain === null ? "Domain restriction removed" : `Protected for @${result.access.allowedDomain}`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  function deactivate() {
    state.active = false;
    shell.hidden = true;
    panel.hidden = true;
    closeComposer();
    host.classList.remove("is-targeting");
  }

  $(".pp-comment-mode").addEventListener("click", () => {
    if (state.access && !state.access.hasAccess) {
      toast(`Use a Zero account with an @${state.access.allowedDomain} email.`, true);
      return;
    }
    setCommentMode(!state.commentMode);
  });
  $(".pp-panel-toggle").addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
  $(".pp-share-review").addEventListener("click", shareReview);
  $(".pp-close").addEventListener("click", deactivate);
  $(".pp-panel-close").addEventListener("click", () => { panel.hidden = true; });
  $(".pp-composer-close").addEventListener("click", closeComposer);
  $(".pp-cancel").addEventListener("click", closeComposer);
  $(".pp-submit").addEventListener("click", postComment);
  $(".pp-refresh").addEventListener("click", () => loadComments(true));
  $(".pp-access-manage").addEventListener("click", () => {
    const form = $(".pp-access-form");
    const input = $("#pp-domain");
    input.value = state.access?.allowedDomain || state.access?.emailDomain || "";
    form.hidden = false;
    requestAnimationFrame(() => input.focus());
  });
  $(".pp-access-cancel").addEventListener("click", () => { $(".pp-access-form").hidden = true; });
  $(".pp-access-remove").addEventListener("click", () => saveProtection(null));
  $(".pp-access-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveProtection($("#pp-domain").value.trim());
  });
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
    state.access = null;
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
