const views = {
  signedOut: document.querySelector("#signed-out"),
  pending: document.querySelector("#pending"),
  signedIn: document.querySelector("#signed-in"),
};
const notice = document.querySelector("#notice");
const MESSAGE_TIMEOUT_MS = 5000;
let authPending = null;
let pollTimer = null;

function show(name) {
  Object.entries(views).forEach(([key, element]) => { element.hidden = key !== name; });
}

function message(type, payload = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Pinpoint took too long to respond. Close and reopen the extension.")));
    }, MESSAGE_TIMEOUT_MS);

    try {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        finish(() => {
          if (runtimeError) return reject(new Error(runtimeError.message));
          if (!response?.ok) return reject(new Error(response?.error || "Pinpoint could not complete that action."));
          resolve(response.data);
        });
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function flash(text, error = false) {
  notice.textContent = text;
  notice.classList.toggle("error", error);
  notice.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { notice.hidden = true; }, 2500);
}

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Zero managed wallet";
}

function renderSignedIn(status) {
  show("signedIn");
  document.querySelector("#account-email").textContent = status.user?.email || "Connected with Zero";
  document.querySelector("#wallet-address").textContent = shortAddress(status.user?.walletAddress);
  document.querySelector("#display-name").value = status.settings?.displayName || "Zero reviewer";
}

function renderPending(pending) {
  authPending = pending;
  show("pending");
  document.querySelector("#user-code").textContent = pending.userCode;
  clearInterval(pollTimer);
  pollTimer = setInterval(pollAuth, Math.max(2500, (pending.pollInterval || 3) * 1000));
  pollAuth();
}

async function loadStatus() {
  // Keep the primary sign-in action available while the background worker wakes up.
  show("signedOut");
  try {
    const status = await message("ZERO_AUTH_STATUS");
    if (status.signedIn) return renderSignedIn(status);
    if (status.pending && status.pending.expiresAt > Date.now()) return renderPending(status.pending);
    show("signedOut");
  } catch {
    show("signedOut");
    flash("Pinpoint is ready. Sign in with Zero to start marking up this page.");
  }
}

async function startAuth() {
  try {
    document.querySelector("#sign-in").disabled = true;
    const pending = await message("ZERO_AUTH_START");
    await chrome.tabs.create({ url: pending.url });
    renderPending(pending);
  } catch (error) {
    flash(error.message, true);
  } finally {
    document.querySelector("#sign-in").disabled = false;
  }
}

async function pollAuth() {
  if (!authPending) return;
  try {
    const result = await message("ZERO_AUTH_POLL", { deviceCode: authPending.deviceCode });
    if (result.status === "ok") {
      clearInterval(pollTimer);
      authPending = null;
      await loadStatus();
      flash("Signed in with Zero");
    } else if (result.status === "expired") {
      clearInterval(pollTimer);
      authPending = null;
      show("signedOut");
      flash("That approval code expired. Start again.", true);
    }
  } catch (error) {
    clearInterval(pollTimer);
    flash(error.message, true);
  }
}

async function toggleOnPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Open a normal website first.");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "PINPOINT_TOGGLE" });
    if (!response?.ok) throw new Error(response?.error || "Pinpoint is unavailable on this page.");
    flash(response.active ? "Pinpoint is active on this page" : "Pinpoint hidden");
  } catch {
    flash("Reload this page once, then open Pinpoint again.", true);
  }
}

document.querySelector("#sign-in").addEventListener("click", startAuth);
document.querySelector("#open-zero").addEventListener("click", () => authPending && chrome.tabs.create({ url: authPending.url }));
document.querySelector("#restart-auth").addEventListener("click", async () => {
  clearInterval(pollTimer);
  authPending = null;
  await message("ZERO_AUTH_CANCEL").catch(() => undefined);
  show("signedOut");
});
document.querySelector("#save-name").addEventListener("click", async () => {
  const displayName = document.querySelector("#display-name").value.trim().slice(0, 60) || "Zero reviewer";
  try { await message("SETTINGS_UPDATE", { settings: { displayName } }); flash("Display name saved"); }
  catch (error) { flash(error.message, true); }
});
document.querySelector("#toggle-page").addEventListener("click", toggleOnPage);
document.querySelector("#sign-out").addEventListener("click", async () => {
  try { await message("ZERO_AUTH_SIGN_OUT"); show("signedOut"); flash("Signed out"); }
  catch (error) { flash(error.message, true); }
});

loadStatus();
