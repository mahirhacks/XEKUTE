"use strict";

const { randomUUID } = require("node:crypto");

// Saved storage values are data. JSON.stringify alone leaves characters that
// can end or reshape surrounding code, so escape them before embedding.
const UNSAFE_SCRIPT_CHARS = { "<": "\\u003C", ">": "\\u003E", "/": "\\u002F", "\u2028": "\\u2028", "\u2029": "\\u2029" };
function scriptLiteral(value) {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => UNSAFE_SCRIPT_CHARS[char]);
}

// This helper serves an empty document from CDP, so importing/exporting storage
// never loads an identity's saved origins from the network or executes site code.
async function withStorageDocument({ WebContentsView, session }, task) {
  const view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  const contents = view.webContents;
  try {
    await contents.loadURL("about:blank");
    contents.debugger.attach("1.3");
    contents.debugger.on("message", (_event, method, params) => {
      if (method !== "Fetch.requestPaused") return;
      contents.debugger.sendCommand("Fetch.fulfillRequest", {
        requestId: params.requestId, responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/html" }, { name: "Content-Security-Policy", value: "default-src 'none'" }],
        body: Buffer.from("<!doctype html><title>Browser storage transfer</title>").toString("base64"),
      }).catch(() => {});
    });
    await contents.debugger.sendCommand("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    return await task(async (origin, source) => {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("Invalid browser storage origin.");
      await contents.loadURL(`${origin}/.xekute-storage-${randomUUID()}`);
      return contents.executeJavaScriptInIsolatedWorld(999, [{ code: source }]);
    });
  } finally {
    if (!contents.isDestroyed()) contents.close();
  }
}

async function importBrowserStorage(dependencies, state) {
  for (const cookie of state.cookies || []) {
    if (cookie.expires > 0 && cookie.expires < Date.now() / 1000) continue;
    const domain = (cookie.domain || "").replace(/^\./, "");
    const url = cookie.url || `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`;
    const value = { url, name: cookie.name, value: cookie.value, path: cookie.path || "/", secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly) };
    if (cookie.domain?.startsWith(".")) value.domain = cookie.domain;
    if (cookie.expires > 0) value.expirationDate = cookie.expires;
    const sameSite = { Strict: "strict", Lax: "lax", None: "no_restriction" }[cookie.sameSite];
    if (sameSite) value.sameSite = sameSite;
    await dependencies.session.cookies.set(value);
  }
  if (!state.origins?.length) return;
  await withStorageDocument(dependencies, async visit => {
    for (const origin of state.origins) {
      await visit(origin.origin, `(() => { localStorage.clear(); for (const item of ${scriptLiteral(origin.localStorage)}) localStorage.setItem(item.name, item.value); })()`);
    }
  });
}

async function exportBrowserStorage(dependencies, origins) {
  const cookies = (await dependencies.session.cookies.get({})).map(cookie => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly, expires: cookie.session ? -1 : cookie.expirationDate,
    sameSite: { strict: "Strict", lax: "Lax", no_restriction: "None", unspecified: "Lax" }[cookie.sameSite] || "Lax",
  }));
  const output = [];
  if (origins.size) await withStorageDocument(dependencies, async visit => {
    for (const origin of origins) output.push({ origin, localStorage: await visit(origin,
      "Object.keys(localStorage).map(name => ({ name, value: localStorage.getItem(name) }))") });
  });
  return { cookies, origins: output };
}

module.exports = { importBrowserStorage, exportBrowserStorage, scriptLiteral };
