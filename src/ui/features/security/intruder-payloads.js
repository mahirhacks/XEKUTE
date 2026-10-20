import {
  securityRequestEditor, securityPayloadEditor, securityPayloadsCount, securityPayloadSetsEl,
  securityPayloadHint, securityPositionsCount, securityPositionChips, securityAttackButtons,
  securityWorkbench, securityIntruderTabButtons, securityIntruderSections, securityResponseEditor,
  securityResultsCount, securityResultsRows, securityResultsEmpty,
} from "../../core/dom-refs.js";
import {
  saveSecurityDraft, syncSecurityExchangeSizes, setSecurityStatus,
} from "../../bootstrap.js";
import { appState } from "../../core/app-state.js";
import { INTRUDER_ATTACK_TYPES, captureIntruderTab, activeIntruderTab } from "./workbench-tabs.js";
import { escapeHtml } from "../../core/text-format.js";

export function wrapIntruderSlot(name) {
  return `§${name}§`;
}

export function intruderSlotPattern() {
  return /§([A-Za-z_][\w-]*)§/g;
}

export function intruderSlots(request = securityRequestEditor?.value || "") {
  return [...new Set([...String(request).matchAll(intruderSlotPattern())].map((match) => match[1]))];
}

export function uniqueSlotName(hint, taken) {
  const clean = String(hint || "").replace(/[^A-Za-z0-9_-]/g, "").replace(/^[^A-Za-z_]+/, "") || "payload";
  if (!taken.includes(clean)) return clean;
  let index = 2;
  while (taken.includes(`${clean}${index}`)) index += 1;
  return `${clean}${index}`;
}

export function readPayloadSets() {
  try {
    const parsed = JSON.parse(securityPayloadEditor?.value || "{}");
    if (Array.isArray(parsed)) return { __shared: parsed.map(String) };
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function renderPayloadSets() {
  if (!securityPayloadSetsEl) return;
  const slots = intruderSlots();
  const stored = readPayloadSets();
  const shared = Array.isArray(stored.__shared) ? stored.__shared : null;
  if (securityPayloadsCount) securityPayloadsCount.textContent = String(slots.length);
  if (securityPayloadHint) {
    securityPayloadHint.textContent = slots.length
      ? "One payload per line."
      : "Mark a payload position in the request first.";
  }
  securityPayloadSetsEl.innerHTML = "";
  if (!slots.length) {
    const empty = document.createElement("span");
    empty.className = "security-position-empty";
    empty.textContent = "No payload positions yet. Select a value in the request, then choose Mark selection.";
    securityPayloadSetsEl.appendChild(empty);
    return;
  }
  for (const slot of slots) {
    const values = shared || (Array.isArray(stored[slot]) ? stored[slot].map(String) : []);
    const wrap = document.createElement("div");
    wrap.className = "security-payload-set";
    wrap.dataset.slot = slot;
    const header = document.createElement("header");
    const name = document.createElement("span");
    name.className = "security-payload-set-name";
    name.textContent = wrapIntruderSlot(slot);
    const count = document.createElement("span");
    count.className = "security-payload-set-count";
    count.textContent = `${values.length} payload${values.length === 1 ? "" : "s"}`;
    header.append(name, count);
    const area = document.createElement("textarea");
    area.spellcheck = false;
    area.value = values.join("\n");
    area.placeholder = "admin\nroot\ntest";
    area.setAttribute("aria-label", `Payloads for ${slot}`);
    area.addEventListener("input", () => {
      const lines = area.value.split("\n").map((line) => line.trim()).filter(Boolean);
      count.textContent = `${lines.length} payload${lines.length === 1 ? "" : "s"}`;
      commitPayloadSets();
    });
    wrap.append(header, area);
    securityPayloadSetsEl.appendChild(wrap);
  }
}

export function commitPayloadSets() {
  if (!securityPayloadSetsEl || !securityPayloadEditor) return;
  const sets = {};
  for (const wrap of securityPayloadSetsEl.querySelectorAll(".security-payload-set")) {
    const slot = wrap.dataset.slot;
    const area = wrap.querySelector("textarea");
    if (!slot || !area) continue;
    sets[slot] = area.value.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  securityPayloadEditor.value = JSON.stringify(sets, null, 2);
  saveSecurityDraft();
}

export function renderPositionChips() {
  const slots = intruderSlots();
  if (securityPositionsCount) securityPositionsCount.textContent = String(slots.length);
  if (!securityPositionChips) return;
  securityPositionChips.innerHTML = "";
  if (!slots.length) {
    const empty = document.createElement("span");
    empty.className = "security-position-empty";
    empty.textContent = "No positions marked yet.";
    securityPositionChips.appendChild(empty);
    return;
  }
  for (const slot of slots) {
    const chip = document.createElement("span");
    chip.className = "security-position-chip";
    chip.textContent = wrapIntruderSlot(slot);
    securityPositionChips.appendChild(chip);
  }
}

export function syncIntruderUi() {
  renderPositionChips();
  renderPayloadSets();
}

export function onSecurityRequestChanged() {
  syncSecurityExchangeSizes();
  if (appState.selectedSecurityTool === "intruder") syncIntruderUi();
}

export function markSelectionAsPosition() {
  if (!securityRequestEditor) return;
  const start = securityRequestEditor.selectionStart;
  const end = securityRequestEditor.selectionEnd;
  if (start === end) {
    setSecurityStatus("Select the value you want to replace, then mark it", "error");
    return;
  }
  const value = securityRequestEditor.value;
  const selected = value.slice(start, end);
  if (intruderSlots(selected).length) {
    setSecurityStatus("That selection already contains a position", "error");
    return;
  }
  const before = value.slice(0, start);
  const hint = before.match(/([A-Za-z_][\w-]*)\s*[=:]\s*"?$/)?.[1] || "payload";
  const slot = uniqueSlotName(hint, intruderSlots(value));
  const marker = wrapIntruderSlot(slot);
  securityRequestEditor.value = `${before}${marker}${value.slice(end)}`;
  const caret = start + marker.length;
  securityRequestEditor.setSelectionRange(caret, caret);
  securityRequestEditor.focus();
  onSecurityRequestChanged();
  setSecurityStatus(`Marked ${marker}`, "success");
}

export function autoDetectPositions() {
  if (!securityRequestEditor) return;
  const value = securityRequestEditor.value;
  if (intruderSlots(value).length) {
    setSecurityStatus("Clear the existing positions before auto-detecting", "error");
    return;
  }
  const taken = [];
  const slotFor = (name) => {
    const slot = uniqueSlotName(name, taken);
    taken.push(slot);
    return wrapIntruderSlot(slot);
  };
  const boundary = value.indexOf("\n\n");
  const lines = (boundary >= 0 ? value.slice(0, boundary) : value).split("\n");
  let body = boundary >= 0 ? value.slice(boundary + 2) : "";
  lines[0] = lines[0].replace(/([?&])([A-Za-z_][\w-]*)=([^&\s]*)/g, (match, separator, name) => `${separator}${name}=${slotFor(name)}`);
  if (body.trim().startsWith("{")) {
    body = body.replace(/("([A-Za-z_][\w-]*)"\s*:\s*)"[^"]*"/g, (match, prefix, name) => `${prefix}"${slotFor(name)}"`);
  } else if (body.trim()) {
    body = body.replace(/(^|&)([A-Za-z_][\w-]*)=([^&\n]*)/g, (match, separator, name) => `${separator}${name}=${slotFor(name)}`);
  }
  if (!taken.length) {
    setSecurityStatus("No query or body parameters found to mark", "error");
    return;
  }
  securityRequestEditor.value = boundary >= 0 ? `${lines.join("\n")}\n\n${body}` : lines.join("\n");
  onSecurityRequestChanged();
  setSecurityStatus(`Marked ${taken.length} position${taken.length === 1 ? "" : "s"}`, "success");
}

export function clearPayloadPositions() {
  if (!securityRequestEditor) return;
  if (!intruderSlots().length) {
    setSecurityStatus("No positions to clear");
    return;
  }
  securityRequestEditor.value = securityRequestEditor.value.replace(intruderSlotPattern(), "");
  onSecurityRequestChanged();
  setSecurityStatus("Cleared payload positions");
}

export function setAttackType(value, { silent = false } = {}) {
  appState.securityAttackTypeValue = INTRUDER_ATTACK_TYPES.includes(value) ? value : "sniper";
  securityAttackButtons.forEach((button) => {
    const active = button.dataset.attackType === appState.securityAttackTypeValue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  if (!silent) {
    saveSecurityDraft();
    if (appState.selectedSecurityTool === "intruder") captureIntruderTab();
  }
}

export function setIntruderTab(tab) {
  const next = ["positions", "payloads", "results"].includes(tab) ? tab : "positions";
  const previous = appState.securityIntruderTab;
  appState.securityIntruderTab = next;
  if (securityWorkbench) securityWorkbench.dataset.intruderTab = next;
  securityIntruderTabButtons.forEach((button) => {
    const active = button.dataset.intruderTab === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  securityIntruderSections.forEach((section) => {
    section.hidden = section.dataset.intruderPanel !== next;
  });
  // Leaving Results restores the templated request so the attack can be re-run.
  if (previous === "results" && next !== "results" && appState.securityIntruderTemplate) {
    securityRequestEditor.value = appState.securityIntruderTemplate;
    securityResponseEditor.value = "";
    appState.securitySelectedResult = -1;
    syncSecurityExchangeSizes();
    renderIntruderResults();
  }
  if (next === "payloads") renderPayloadSets();
  if (next === "positions") renderPositionChips();
  const active = appState.selectedSecurityTool === "intruder" ? activeIntruderTab() : null;
  if (active) active.panel = next;
}

export function intruderPayloadLabel(generated, template) {
  const slots = [];
  try {
    const pattern = String(template)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/§([A-Za-z_][\w-]*)§/g, (match, name) => {
        slots.push(name);
        return "([\\s\\S]*?)";
      });
    if (!slots.length) return "—";
    const matched = new RegExp(`^${pattern}$`).exec(String(generated));
    if (!matched) return "—";
    const label = slots.map((slot, index) => `${slot}=${matched[index + 1]}`).join(", ");
    return label.length > 90 ? `${label.slice(0, 89)}…` : label;
  } catch {
    return "—";
  }
}

export function renderIntruderResults() {
  if (securityResultsCount) securityResultsCount.textContent = String(appState.securityIntruderResults.length);
  if (securityResultsEmpty) securityResultsEmpty.hidden = appState.securityIntruderResults.length > 0;
  if (!securityResultsRows) return;
  securityResultsRows.innerHTML = "";
  appState.securityIntruderResults.forEach((result, index) => {
    const row = document.createElement("tr");
    row.classList.toggle("selected", index === appState.securitySelectedResult);
    const statusClass = result.status ? `result-status-${String(result.status).charAt(0)}` : "";
    row.innerHTML = `
      <td class="result-num">${index + 1}</td>
      <td title="${escapeHtml(result.payload)}">${escapeHtml(result.payload)}</td>
      <td class="${statusClass}">${escapeHtml(String(result.status || "—"))}</td>
      <td class="result-len">${escapeHtml(result.length)}</td>
      <td class="result-time">${escapeHtml(result.time)}</td>`;
    row.addEventListener("click", () => selectIntruderResult(index));
    securityResultsRows.appendChild(row);
  });
}

export function selectIntruderResult(index) {
  const result = appState.securityIntruderResults[index];
  if (!result) return;
  appState.securitySelectedResult = index;
  securityRequestEditor.value = result.request || "";
  securityResponseEditor.value = result.response || "";
  syncSecurityExchangeSizes();
  renderIntruderResults();
}
