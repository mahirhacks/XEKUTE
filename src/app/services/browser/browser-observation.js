"use strict";

const { randomUUID } = require("node:crypto");

const OBSERVATION_LIMIT = 16000;
const fail = message => Object.assign(new Error(message), { code: "BROWSER_OBSERVATION_STALE" });
const safeUrl = value => { try { return ["http:", "https:"].includes(new URL(value).protocol) ? value.slice(0, 8192) : "about:blank"; } catch { return "about:blank"; } };

function boundObservation(value, limit = OBSERVATION_LIMIT) {
  const bounded = structuredClone(value);
  bounded.url = bounded.url.slice(0, 2048);
  bounded.title = bounded.title.slice(0, 1000);
  bounded.frames = bounded.frames.map(frame => ({ ...frame, url: frame.url.slice(0, 1024) }));
  bounded.text = bounded.text.slice(0, 11000);
  bounded.elements = bounded.elements.slice(0, 80);
  bounded.frames = bounded.frames.slice(0, 30);
  bounded.truncated ||= bounded.text.length < value.text.length || bounded.elements.length < value.elements.length || bounded.frames.length < value.frames.length
    || bounded.url.length < value.url.length || bounded.title.length < value.title.length || bounded.frames.some((frame, index) => frame.url.length < value.frames[index].url.length);
  while (JSON.stringify(bounded).length > limit && bounded.elements.length) { bounded.elements.pop(); bounded.truncated = true; }
  while (JSON.stringify(bounded).length > limit && bounded.frames.length > 1) { bounded.frames.pop(); bounded.truncated = true; }
  bounded.elements = bounded.elements.filter(item => bounded.frames.some(frame => frame.id === item.frameId));
  const excess = JSON.stringify(bounded).length - limit;
  if (excess > 0) { bounded.text = bounded.text.slice(0, Math.max(0, bounded.text.length - excess)); bounded.truncated = true; }
  return bounded;
}

function createBrowserObservations({ artifactStore = null } = {}) {
  const current = new Map();
  const keys = new Map();
  async function capture(page, tab) {
    const id = `obs-${randomUUID()}`;
    const identity = keys.get(tab.id) || { key: `__xekuteRefs_${randomUUID().replaceAll("-", "")}`, secret: randomUUID() };
    const { key, secret } = identity;
    keys.set(tab.id, identity);
    const frames = [], elements = [], text = [];
    let truncated = false;
    for (const [index, frame] of page.frames().slice(0, 100).entries()) {
      const frameId = `frame-${index}`;
      try {
        const data = await frame.evaluate(({ key, secret, id, frameId }) => {
          const refs = new Map();
          const visible = node => {
            if (!node.isConnected || node.closest("[hidden],[inert],[aria-hidden='true']")) return false;
            const style = getComputedStyle(node), box = node.getBoundingClientRect();
            return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
          };
          const roleFor = node => node.getAttribute("role") || ({ A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", INPUT: ({ checkbox: "checkbox", radio: "radio", button: "button", submit: "button", range: "slider", file: "file" }[node.type] || "textbox"), IFRAME: "iframe", CANVAS: "canvas" }[node.tagName] || "control");
          const names = node => (node.getAttribute("aria-label") || (node.getAttribute("aria-labelledby") || "").split(/\s+/).map(label => document.getElementById(label)?.innerText || "").join(" ").trim()
            || Array.from(node.labels || []).map(label => label.innerText).join(" ") || node.getAttribute("placeholder") || node.getAttribute("title") || node.innerText || node.getAttribute("alt") || node.name || "").replace(/\s+/g, " ").trim().slice(0, 180);
          const selected = Array.from(document.querySelectorAll("a[href],button,input:not([type=hidden]),textarea,select,[role],[tabindex],[contenteditable=true],canvas,iframe")).filter(visible);
          const entries = selected.slice(0, 300).map((node, index) => {
            const ref = `${frameId}-e${index + 1}`; refs.set(ref, node);
            return { ref, frameId, role: roleFor(node).slice(0, 100), name: names(node), ...(node.form && ["submit", "image"].includes(node.type) ? { submits: true } : {}), ...(node.type === "password" ? { secret: true } : {}) };
          });
          // Controls sharing a name, like a Delete button on every row, get the
          // text of the nearest container that says more than the name itself.
          const counts = new Map();
          for (const entry of entries) counts.set(entry.name, (counts.get(entry.name) || 0) + 1);
          entries.forEach((entry, index) => {
            if (counts.get(entry.name) < 2) return;
            for (let node = selected[index].parentElement; node && node !== document.body; node = node.parentElement) {
              const context = (node.innerText || "").replace(entry.name, "").replace(/\s+/g, " ").trim();
              if (context) { entry.context = context.slice(0, 100); break; }
            }
          });
          // Keep exact nodes in an immutable resolver closure. Only the host's
          // update capability can replace the current bounded reference set.
          if (!Object.hasOwn(window, key)) {
            let state = { id, refs };
            const updateCapability = secret;
            Object.defineProperty(window, key, { configurable: false, enumerable: false, writable: false,
              value: Object.freeze(function browserReference(operation, capability, observationId, ref, nextRefs) {
                if (operation === "replace" && capability === updateCapability) { state = { id: observationId, refs: nextRefs }; return true; }
                if (operation !== "resolve" || state.id !== observationId) return null;
                const node = state.refs.get(ref);
                return node?.isConnected ? node : null;
              }) });
          } else if (window[key]("replace", secret, id, null, refs) !== true) throw new Error("Browser references are unavailable.");
          const raw = document.body?.innerText || "";
          return { text: raw.slice(0, 64000), elements: entries, truncated: raw.length > 64000 || selected.length > 300 };
        }, { key, secret, id, frameId });
        frames.push({ id: frameId, url: safeUrl(frame.url()) });
        elements.push(...data.elements); text.push(`[${frameId}]\n${data.text}`); truncated ||= data.truncated;
      } catch (error) {
        if (page.isClosed()) throw error;
        truncated = true;
      }
      if (text.join("\n").length > 180000 || elements.length > 1000) { truncated = true; break; }
    }
    const full = { id, tabId: tab.id, documentVersion: tab.documentVersion, viewportRevision: tab.viewportRevision,
      url: safeUrl(page.url()), title: (await page.title()).slice(0, 2000), text: text.join("\n\n"), truncated,
      frames, elements, artifactIds: [] };
    let observation = boundObservation(full);
    if (observation.truncated && artifactStore) {
      const artifact = await artifactStore.put({ projectId: tab.projectId, kind: "observation", mimeType: "application/json", data: Buffer.from(JSON.stringify(full)), metadata: { tabId: tab.id, observationId: id } });
      observation.artifactIds = [artifact.id || artifact.artifactId];
      observation = boundObservation(observation);
    }
    current.set(tab.id, { observation, key });
    return observation;
  }
  async function resolve(target, page, tab) {
    const stored = current.get(tab.id), observation = stored?.observation;
    if (!observation || target.observationId !== observation.id || observation.documentVersion !== tab.documentVersion || observation.viewportRevision !== tab.viewportRevision
      || !observation.elements.some(item => item.ref === target.ref)) throw fail("The browser observation is no longer current. Observe again before acting.");
    const entry = observation.elements.find(item => item.ref === target.ref);
    // Each action reconnects, so frames are found by position. A shifted list
    // fails closed: each frame resolves only references carrying its own prefix.
    const index = Number(entry.frameId.slice(6)), frame = page.frames()[index];
    if (!frame) throw fail("The referenced frame was removed.");
    const handle = await frame.evaluateHandle(({ key, id, ref }) => {
      const resolve = window[key];
      return typeof resolve === "function" ? resolve("resolve", null, id, ref) : null;
    }, { key: stored.key, id: observation.id, ref: target.ref });
    const element = handle.asElement();
    if (!element) { await handle.dispose(); throw fail("The referenced element was removed or replaced. Observe again before acting."); }
    return element;
  }
  function describe(tabId, target) {
    const observation = current.get(tabId)?.observation;
    if (target?.kind !== "element" || observation?.id !== target.observationId) return null;
    const entry = observation.elements.find(item => item.ref === target.ref);
    return entry ? { ...entry, frameUrl: observation.frames.find(frame => frame.id === entry.frameId)?.url || "" } : null;
  }
  return Object.freeze({ capture, resolve, describe, forget: id => { current.delete(id); keys.delete(id); }, clear: () => { current.clear(); keys.clear(); } });
}

module.exports = { createBrowserObservations, boundObservation, OBSERVATION_LIMIT };
