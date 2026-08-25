import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("sharing creates immutable DOM archives with anchored feedback and an explicit image fallback", async () => {
  const [content, background, server, publicClient, publicHtml, publicScrollCss, hosting, manifest, popup] = await Promise.all([
    readFile(new URL("../extension/content.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/background.js", import.meta.url), "utf8"),
    readFile(new URL("../zero-app/server.js", import.meta.url), "utf8"),
    readFile(new URL("../zero-site/app.js", import.meta.url), "utf8"),
    readFile(new URL("../zero-site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../zero-site/scroll.css", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../extension/manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../extension/popup.html", import.meta.url), "utf8"),
  ]);

  assert.match(content, /captureFullPageSnapshot/);
  assert.match(content, /CAPTURE_PUBLISH/);
  assert.match(content, /buildDomAnchor/);
  assert.match(content, /resolveDomAnchor/);
  assert.match(content, /SNAPSHOT_VIEWPORT/);
  assert.match(content, /SNAPSHOT_UPLOAD/);
  assert.match(content, /beginCommentEdit/);
  assert.match(content, /pinpoint-extension-v1/);
  assert.match(content, /shell\.style\.visibility = "hidden"/);
  assert.match(background, /chrome\.tabs\.captureVisibleTab/);
  assert.match(background, /\/api\/snapshot/);
  assert.match(background, /\/api\/captures/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS captures/);
  assert.match(server, /capture_comment_positions/);
  assert.match(server, /puppeteer\.launch/);
  assert.match(server, /assertPublicUrl/);
  assert.match(server, /serializeDomArchive/);
  assert.match(server, /capturePublicPageFromHtml/);
  assert.match(server, /renderArchiveHtml/);
  assert.match(server, /sanitizeArchiveMarkup/);
  assert.match(server, /agent-storefront/);
  assert.match(server, /canEdit/);
  assert.match(server, /Only the comment author can edit its text/);
  assert.match(server, /archive_html/);
  assert.match(server, /artifact_type/);
  assert.match(server, /\/api\/artifact/);
  assert.match(server, /\/api\/archive/);
  assert.match(server, /sandbox allow-scripts/);
  assert.match(publicHtml, /id="archive-surface"/);
  assert.match(publicHtml, /id="review-archive"/);
  assert.match(publicHtml, /sandbox="allow-scripts"/);
  assert.match(publicHtml, /id="capture-surface"/);
  assert.match(publicClient, /scrollIntoView/);
  assert.match(publicClient, /dataset\.commentId/);
  assert.match(publicClient, /pinpoint-archive-v1/);
  assert.match(publicClient, /postMessage/);
  assert.match(publicClient, /LIVE DOM/);
  assert.match(publicClient, /IMAGE FALLBACK/);
  assert.match(publicClient, /captureId/);
  assert.match(publicClient, /beginEditComment/);
  assert.match(publicClient, /commentsRequest/);
  assert.match(publicScrollCss, /overflow:\s*auto/);
  assert.match(publicScrollCss, /archive-mode/);
  assert.equal(hosting.r2, "SNAPSHOTS");
  assert.equal(manifest.version, "0.10.0");
  assert.match(popup, /v0\.10\.0/);
  assert.match(content, /https:\/\/deploy-9po6nd1t-nlbndjpuja-uc\.a\.run\.app\//);
  assert.doesNotMatch(content, /chatgpt\.site/);
  assert.doesNotMatch(background, /chatgpt\.site/);
});

test("the extension captures the sender tab and uploads the image with page geometry", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  let listener;
  let captureCall;
  let uploadCall;
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const dataUrl = `data:image/jpeg;base64,${Buffer.from(imageBytes).toString("base64")}`;
  const context = {
    chrome: {
      storage: {
        local: {
          async get() {
            return { zeroSession: { accessToken: "zero-test-token", refreshToken: "refresh-test-token" } };
          },
          async set() {},
          async remove() {},
        },
      },
      tabs: {
        async captureVisibleTab(windowId, options) {
          captureCall = { windowId, options };
          return dataUrl;
        },
      },
      runtime: {
        onMessage: {
          addListener(callback) {
            listener = callback;
          },
        },
      },
    },
    async fetch(input, init) {
      if (String(input).startsWith("data:")) {
        return new Response(new Blob([imageBytes], { type: "image/jpeg" }));
      }
      uploadCall = {
        url: String(input),
        method: init.method,
        headers: new Headers(init.headers),
        body: init.body,
      };
      return Response.json({ ok: true, capturedAt: "2026-08-24T21:00:00.000Z" }, { status: 201 });
    },
    URL,
    Headers,
    Response,
    Blob,
    Error,
    Promise,
    encodeURIComponent,
  };

  vm.runInNewContext(source, context, { filename: "extension/background.js" });
  assert.equal(typeof listener, "function");
  const result = await new Promise((resolve) => {
    listener({
      type: "SNAPSHOT_CAPTURE",
      pageUrl: "https://zeroclick.ai/trends",
      pageTitle: "AI Purchase Trends | ZeroClick",
      metrics: {
        pageWidth: 1440,
        pageHeight: 3200,
        viewportWidth: 1440,
        viewportHeight: 900,
        scrollX: 0,
        scrollY: 480,
        devicePixelRatio: 2,
      },
    }, { tab: { windowId: 17 } }, resolve);
  });

  assert.equal(result.ok, true);
  assert.equal(captureCall.windowId, 17);
  assert.equal(captureCall.options.format, "jpeg");
  assert.equal(captureCall.options.quality, 88);
  assert.match(uploadCall.url, /^https:\/\/deploy-9po6nd1t-nlbndjpuja-uc\.a\.run\.app\/api\/snapshot\?url=/);
  assert.equal(uploadCall.method, "POST");
  assert.equal(uploadCall.headers.get("authorization"), "Bearer zero-test-token");
  assert.equal(uploadCall.headers.get("x-page-height"), "3200");
  assert.equal(uploadCall.headers.get("x-scroll-y"), "480");
  assert.equal(uploadCall.headers.get("x-viewport-height"), "900");
  assert.equal(uploadCall.body.type, "image/jpeg");
});

test("the extension captures viewport tiles and uploads an assembled full-page image", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  let listener;
  let uploadCall;
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const dataUrl = `data:image/jpeg;base64,${Buffer.from(imageBytes).toString("base64")}`;
  const context = {
    chrome: {
      storage: { local: {
        async get() { return { zeroSession: { accessToken: "zero-test-token" } }; },
        async set() {}, async remove() {},
      } },
      tabs: { async captureVisibleTab() { return dataUrl; } },
      runtime: { onMessage: { addListener(callback) { listener = callback; } } },
    },
    async fetch(input, init) {
      if (String(input).startsWith("data:")) return new Response(new Blob([imageBytes], { type: "image/jpeg" }));
      uploadCall = { url: String(input), headers: new Headers(init.headers), body: init.body };
      return Response.json({ ok: true }, { status: 201 });
    },
    URL, Headers, Response, Blob, Error, Promise, encodeURIComponent,
  };
  vm.runInNewContext(source, context, { filename: "extension/background.js" });

  const viewport = await new Promise((resolve) => listener(
    { type: "SNAPSHOT_VIEWPORT" },
    { tab: { windowId: 23 } },
    resolve,
  ));
  assert.equal(viewport.ok, true);
  assert.equal(viewport.data.dataUrl, dataUrl);

  const upload = await new Promise((resolve) => listener({
    type: "SNAPSHOT_UPLOAD",
    dataUrl,
    pageUrl: "https://zeroclick.ai/trends",
    pageTitle: "AI Purchase Trends | ZeroClick",
    metrics: {
      pageWidth: 1440,
      pageHeight: 5200,
      viewportWidth: 1440,
      viewportHeight: 5200,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
    },
  }, {}, resolve));

  assert.equal(upload.ok, true);
  assert.equal(uploadCall.headers.get("x-page-height"), "5200");
  assert.equal(uploadCall.headers.get("x-viewport-height"), "5200");
  assert.equal(uploadCall.headers.get("x-scroll-y"), "0");
  assert.equal(uploadCall.body.type, "image/jpeg");
});

test("the extension asks the Zero-hosted service to create the public capture revision", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  let listener;
  let request;
  const context = {
    chrome: {
      storage: { local: {
        async get() { return { zeroSession: { accessToken: "zero-test-token" } }; },
        async set() {}, async remove() {},
      } },
      tabs: { async captureVisibleTab() { throw new Error("fallback should not run"); } },
      runtime: { onMessage: { addListener(callback) { listener = callback; } } },
    },
    async fetch(input, init) {
      request = { url: String(input), method: init.method, headers: new Headers(init.headers), body: init.body };
      return Response.json({ ok: true, captureId: "revision-123", source: "zero-browser" }, { status: 201 });
    },
    URL, Headers, Response, Blob, Error, Promise, encodeURIComponent,
  };
  vm.runInNewContext(source, context, { filename: "extension/background.js" });

  const response = await new Promise((resolve) => listener({
    type: "CAPTURE_PUBLISH",
    capture: { pageUrl: "https://example.com/", viewportWidth: 1440, viewportHeight: 900 },
  }, {}, resolve));

  assert.equal(response.ok, true);
  assert.equal(response.data.captureId, "revision-123");
  assert.equal(request.url, "https://deploy-9po6nd1t-nlbndjpuja-uc.a.run.app/api/captures");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("authorization"), "Bearer zero-test-token");
  assert.equal(JSON.parse(request.body).pageUrl, "https://example.com/");
});

test("the public review fills the available workspace width", async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL("../zero-site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../zero-site/full-width.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /full-width\.css/);
  assert.match(styles, /\.browser-frame\s*\{[\s\S]*?width:\s*100%/);
  assert.match(styles, /max-width:\s*none/);
});

test("the extension forwards authenticated comment edits and revision-aware comment lists", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  let listener;
  const requests = [];
  const context = {
    chrome: {
      storage: { local: {
        async get() { return { zeroSession: { accessToken: "zero-test-token", refreshToken: "refresh-test-token" } }; },
        async set() {}, async remove() {},
      } },
      runtime: { onMessage: { addListener(callback) { listener = callback; } } },
      tabs: {},
    },
    async fetch(input, init) {
      requests.push({ url: String(input), method: init.method, headers: new Headers(init.headers), body: init.body });
      if (init.method === "PATCH") return Response.json({ ok: true, comment: { id: 7, body: "Updated copy", canEdit: true } });
      return Response.json({ comments: [{ id: 7, body: "Original copy", canEdit: true }] });
    },
    URL, Headers, Response, Blob, Error, Promise, encodeURIComponent,
  };
  vm.runInNewContext(source, context, { filename: "extension/background.js" });

  const listed = await new Promise((resolve) => listener({
    type: "COMMENTS_LIST", pageUrl: "https://example.com/", captureId: "capture-123",
  }, {}, resolve));
  const edited = await new Promise((resolve) => listener({
    type: "COMMENTS_UPDATE", comment: { id: 7, body: "Updated copy", pageUrl: "https://example.com/" },
  }, {}, resolve));

  assert.equal(listed.ok, true);
  assert.equal(edited.ok, true);
  assert.match(requests[0].url, /capture=capture-123/);
  assert.equal(requests[1].method, "PATCH");
  assert.equal(requests[1].headers.get("authorization"), "Bearer zero-test-token");
  assert.equal(JSON.parse(requests[1].body).body, "Updated copy");
});
