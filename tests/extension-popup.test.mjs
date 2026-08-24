import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

function element() {
  return {
    hidden: false,
    textContent: "",
    value: "",
    disabled: false,
    classList: { toggle() {} },
    addEventListener() {},
  };
}

test("popup exposes sign-in immediately when the background worker stalls", async () => {
  const source = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../extension/popup.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../extension/popup.css", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const elements = new Map();
  const timers = [];
  const querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, element());
    return elements.get(selector);
  };
  elements.set("#signed-out", element());
  elements.set("#pending", { ...element(), hidden: true });
  elements.set("#signed-in", { ...element(), hidden: true });
  elements.set("#notice", { ...element(), hidden: true });

  const context = {
    document: { querySelector },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage() {
          // Deliberately never respond: this recreates the reported startup stall.
        },
      },
      tabs: {
        create: async () => undefined,
        query: async () => [],
        sendMessage: async () => ({ ok: false }),
      },
    },
    window: {
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
    },
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    setInterval() { return 1; },
    clearInterval() {},
    URL,
    URLSearchParams,
    Promise,
    Error,
  };

  vm.runInNewContext(source, context, { filename: "extension/popup.js" });

  assert.doesNotMatch(html, /Connecting to Zero/);
  assert.match(html, new RegExp(`v${manifest.version.replaceAll(".", "\\.")}`));
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.equal(elements.get("#signed-out").hidden, false);

  timers.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(elements.get("#signed-out").hidden, false);
  assert.equal(elements.get("#notice").hidden, false);
  assert.match(elements.get("#notice").textContent, /ready/i);
});
