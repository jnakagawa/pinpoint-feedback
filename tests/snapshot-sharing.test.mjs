import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("sharing captures the visible website and the public page renders that capture", async () => {
  const [content, background, page, hosting, manifest, popup] = await Promise.all([
    readFile(new URL("../extension/content.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/background.js", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../extension/manifest.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../extension/popup.html", import.meta.url), "utf8"),
  ]);

  assert.match(content, /SNAPSHOT_CAPTURE/);
  assert.match(content, /shell\.style\.visibility = "hidden"/);
  assert.match(background, /chrome\.tabs\.captureVisibleTab/);
  assert.match(background, /\/api\/snapshot/);
  assert.match(page, /className="review-snapshot"/);
  assert.match(page, /No page capture yet/);
  assert.doesNotMatch(page, /We shape quiet ideas|Independent creative studio|className="sample-art"/);
  assert.equal(hosting.r2, "SNAPSHOTS");
  assert.equal(manifest.version, "0.6.0");
  assert.match(popup, /v0\.6\.0/);
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
