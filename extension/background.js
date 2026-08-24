const ZERO_API = "https://api.zero.xyz";
const ZERO_SDK_VERSION = "1.33.0";
const BACKEND_API = "https://pinpoint-feedback.transqualia.chatgpt.site/api/comments";

const storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },
  async set(value) {
    return chrome.storage.local.set(value);
  },
  async remove(keys) {
    return chrome.storage.local.remove(keys);
  },
};

async function zeroRequest(path, init = {}, canRefresh = true) {
  const { zeroSession } = await storage.get("zeroSession");
  const headers = new Headers(init.headers || {});
  headers.set("x-zero-sdk-version", ZERO_SDK_VERSION);
  if (init.body) headers.set("content-type", "application/json");
  if (zeroSession?.accessToken) headers.set("authorization", `Bearer ${zeroSession.accessToken}`);

  const response = await fetch(`${ZERO_API}${path}`, { ...init, headers });
  if (response.status === 401 && canRefresh && zeroSession?.refreshToken) {
    const refreshed = await refreshZeroSession(zeroSession.refreshToken);
    if (refreshed) return zeroRequest(path, init, false);
  }
  return response;
}

async function refreshZeroSession(refreshToken) {
  const response = await fetch(`${ZERO_API}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-zero-sdk-version": ZERO_SDK_VERSION },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    await storage.remove(["zeroSession"]);
    return false;
  }
  const next = await response.json();
  const { zeroSession } = await storage.get("zeroSession");
  await storage.set({
    zeroSession: {
      ...zeroSession,
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      updatedAt: Date.now(),
    },
  });
  return true;
}

async function startZeroAuth() {
  const response = await zeroRequest("/v1/auth/device/start", { method: "POST" }, false);
  if (!response.ok) throw new Error("Zero Auth could not start. Please try again.");
  const pending = await response.json();
  pending.url = `${pending.verificationUri}?code=${encodeURIComponent(pending.userCode)}`;
  await storage.set({ pendingZeroAuth: pending });
  return pending;
}

async function pollZeroAuth(deviceCode) {
  const response = await zeroRequest("/v1/auth/device/poll", {
    method: "POST",
    body: JSON.stringify({ deviceCode }),
  }, false);
  if (!response.ok) throw new Error("Zero Auth could not finish.");
  const result = await response.json();
  if (result.error === "authorization_pending") return { status: "pending" };
  if (result.error === "expired_token") {
    await storage.remove(["pendingZeroAuth"]);
    return { status: "expired" };
  }

  const primaryWallet = result.user?.wallets?.find((wallet) => wallet.isPrimary)?.walletAddress
    || result.user?.wallets?.[0]?.walletAddress
    || null;
  const zeroSession = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    user: {
      id: result.user?.id,
      email: result.user?.email || null,
      walletAddress: primaryWallet,
    },
    updatedAt: Date.now(),
  };
  const fallbackName = result.user?.email?.split("@")[0] || "Zero reviewer";
  const { settings = {} } = await storage.get("settings");
  await storage.set({
    zeroSession,
    settings: { ...settings, displayName: settings.displayName || fallbackName },
  });
  await storage.remove(["pendingZeroAuth"]);
  return { status: "ok", user: zeroSession.user };
}

async function authStatus() {
  const { zeroSession, pendingZeroAuth, settings = {} } = await storage.get([
    "zeroSession",
    "pendingZeroAuth",
    "settings",
  ]);
  return {
    signedIn: Boolean(zeroSession?.accessToken),
    user: zeroSession?.user || null,
    pending: pendingZeroAuth || null,
    settings,
  };
}

async function signOut() {
  const { zeroSession } = await storage.get("zeroSession");
  if (zeroSession?.refreshToken) {
    fetch(`${ZERO_API}/v1/auth/logout`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${zeroSession.accessToken}`,
        "content-type": "application/json",
        "x-zero-sdk-version": ZERO_SDK_VERSION,
      },
      body: JSON.stringify({ refreshToken: zeroSession.refreshToken }),
    }).catch(() => undefined);
  }
  await storage.remove(["zeroSession", "pendingZeroAuth"]);
  return { ok: true };
}

async function backendRequest(method, payload = null, pageUrl = null, canRefresh = true) {
  const { zeroSession } = await storage.get("zeroSession");
  if (!zeroSession?.accessToken) throw new Error("Sign in with Zero first.");
  const url = new URL(BACKEND_API);
  if (pageUrl) url.searchParams.set("url", pageUrl);
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${zeroSession.accessToken}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (response.status === 401 && canRefresh && zeroSession.refreshToken) {
    const refreshed = await refreshZeroSession(zeroSession.refreshToken);
    if (refreshed) return backendRequest(method, payload, pageUrl, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Pinpoint sync failed (${response.status}).`);
  return data;
}

async function handleMessage(message) {
  switch (message.type) {
    case "ZERO_AUTH_START":
      return startZeroAuth();
    case "ZERO_AUTH_POLL":
      return pollZeroAuth(message.deviceCode);
    case "ZERO_AUTH_STATUS":
      return authStatus();
    case "ZERO_AUTH_SIGN_OUT":
      return signOut();
    case "ZERO_AUTH_CANCEL":
      await storage.remove(["pendingZeroAuth"]);
      return { ok: true };
    case "SETTINGS_UPDATE": {
      const { settings = {} } = await storage.get("settings");
      const next = { ...settings, ...message.settings };
      await storage.set({ settings: next });
      return { settings: next };
    }
    case "COMMENTS_LIST":
      return backendRequest("GET", null, message.pageUrl);
    case "COMMENTS_CREATE":
      return backendRequest("POST", message.comment);
    case "COMMENTS_UPDATE":
      return backendRequest("PATCH", message.comment);
    default:
      throw new Error("Unknown Pinpoint request.");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }));
  return true;
});
