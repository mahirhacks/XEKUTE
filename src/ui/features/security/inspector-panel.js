import {
  securityInspectorStatus, securityInspectorTabs, securityInspectorPanels, securityInspector,
  securityInspectorToggle, securityInspectorPanel, securityRequestEditor, securityResponseEditor,
  securityInspectorContext, inspectorDecoderInput, inspectorDecoderFormat, inspectorDecoderOutput,
  inspectorJwtAnalysis, inspectorJwtToken, inspectorJwtHeader, inspectorJwtPayload,
  inspectorJwtAlg, inspectorJwtSecret, inspectorCookieInput, inspectorCookieResults,
} from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { SECURITY_INSPECTOR_TAB_KEY, SECURITY_INSPECTOR_OPEN_KEY } from "./workbench-runner.js";
import { escapeHtml } from "../../core/text-format.js";

export function setSecurityInspectorStatus(message, tone = "") {
  if (!securityInspectorStatus) return;
  securityInspectorStatus.textContent = message || "Ready";
  securityInspectorStatus.classList.toggle("error", tone === "error");
  securityInspectorStatus.classList.toggle("success", tone === "success");
}

export function setSecurityInspectorTab(tab) {
  appState.securityInspectorTab = ["decoder", "jwt", "cookies"].includes(tab) ? tab : "decoder";
  securityInspectorTabs.forEach((button) => {
    const active = button.dataset.inspectorTab === appState.securityInspectorTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  securityInspectorPanels.forEach((panel) => { panel.hidden = panel.dataset.inspectorPanel !== appState.securityInspectorTab; });
  localStorage.setItem(SECURITY_INSPECTOR_TAB_KEY, appState.securityInspectorTab);
}

export function setSecurityInspectorOpen(open) {
  const expanded = Boolean(open);
  securityInspector?.classList.toggle("collapsed", !expanded);
  if (securityInspectorPanel) securityInspectorPanel.hidden = !expanded;
  securityInspectorToggle?.setAttribute("aria-expanded", String(expanded));
  if (securityInspectorToggle) securityInspectorToggle.title = expanded ? "Close Inspector" : "Open Inspector";
  localStorage.setItem(SECURITY_INSPECTOR_OPEN_KEY, String(expanded));
  if (expanded) { setSecurityInspectorTab(appState.securityInspectorTab); refreshSecurityInspectorContext(); }
}

export function inspectorEditorSelection() {
  const editor = [securityRequestEditor, securityResponseEditor].find((candidate) => candidate === document.activeElement)
    || [securityRequestEditor, securityResponseEditor].find((candidate) => candidate && candidate.selectionEnd > candidate.selectionStart);
  if (!editor) return "";
  return editor.value.slice(editor.selectionStart, editor.selectionEnd);
}

export function refreshSecurityInspectorContext() {
  if (!securityInspectorContext || !window.SecurityInspectorCodec) return;
  const request = securityRequestEditor?.value || "";
  const response = securityResponseEditor?.value || "";
  const jwtCount = [request, response].filter((value) => SecurityInspectorCodec.findJwt(value)).length;
  const cookieCount = SecurityInspectorCodec.extractHeaderValues(request, "cookie").length + SecurityInspectorCodec.extractHeaderValues(response, "set-cookie").length;
  securityInspectorContext.textContent = `${jwtCount} JWT source${jwtCount === 1 ? "" : "s"} · ${cookieCount} cookie header${cookieCount === 1 ? "" : "s"} detected`;
}

export function loadInspectorDecoderSource(source) {
  if (!inspectorDecoderInput) return;
  const value = source === "selection" ? inspectorEditorSelection()
    : source === "response" ? securityResponseEditor?.value || ""
      : securityRequestEditor?.value || "";
  inspectorDecoderInput.value = value;
  setSecurityInspectorStatus(value ? `Loaded ${source}` : `No ${source} content available`, value ? "success" : "error");
}

export function runInspectorTransform(direction) {
  try {
    const codec = window.SecurityInspectorCodec;
    if (!codec) throw new Error("Inspector codec is unavailable");
    const input = inspectorDecoderInput?.value || "";
    const format = inspectorDecoderFormat?.value || "url-component";
    inspectorDecoderOutput.value = direction === "encode" ? codec.encodeTransform(input, format) : codec.decodeTransform(input, format);
    setSecurityInspectorStatus(`${direction === "encode" ? "Encoded" : "Decoded"} as ${format}`, "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

export function renderInspectorJwtAnalysis(parsed, verification = "") {
  if (!inspectorJwtAnalysis) return;
  const analysis = SecurityInspectorCodec.analyzeJwt(parsed);
  const warnings = analysis.warnings.map((item) => `<li class="warning">${escapeHtml(item)}</li>`).join("");
  const observations = analysis.observations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  inspectorJwtAnalysis.className = "inspector-analysis";
  inspectorJwtAnalysis.innerHTML = `<strong>${escapeHtml(analysis.algorithm)} · ${analysis.signed ? "signature present" : "unsigned"}${verification ? ` · ${escapeHtml(verification)}` : ""}</strong>${warnings || observations ? `<ul>${warnings}${observations}</ul>` : '<span class="success">No obvious structural warnings.</span>'}`;
}

export function decodeInspectorJwt(token = inspectorJwtToken?.value || "") {
  try {
    const parsed = SecurityInspectorCodec.parseJwt(token);
    inspectorJwtToken.value = parsed.token;
    inspectorJwtHeader.value = JSON.stringify(parsed.header, null, 2);
    inspectorJwtPayload.value = JSON.stringify(parsed.payload, null, 2);
    if (["HS256", "HS384", "HS512", "none"].includes(parsed.header.alg)) inspectorJwtAlg.value = parsed.header.alg;
    renderInspectorJwtAnalysis(parsed);
    setSecurityInspectorStatus("JWT decoded locally; signature has not been trusted or verified", "success");
    return parsed;
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); return null; }
}

export function loadInspectorJwtSource(source) {
  const raw = source === "response" ? securityResponseEditor?.value : securityRequestEditor?.value;
  const token = SecurityInspectorCodec.findJwt(raw || "");
  if (!token) { setSecurityInspectorStatus(`No JWT found in ${source}`, "error"); return; }
  inspectorJwtToken.value = token;
  decodeInspectorJwt(token);
}

export async function importInspectorHmacKey(secret, algorithm) {
  if (!secret) throw new Error("Enter an HMAC secret for signing or verification");
  const hash = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[algorithm];
  if (!hash) throw new Error(`Unsupported signing algorithm: ${algorithm}`);
  return crypto.subtle.importKey("raw", SecurityInspectorCodec.utf8Bytes(secret), { name: "HMAC", hash }, false, ["sign", "verify"]);
}

export async function signInspectorJwt() {
  try {
    const header = JSON.parse(inspectorJwtHeader.value || "{}");
    const payload = JSON.parse(inspectorJwtPayload.value || "{}");
    const algorithm = inspectorJwtAlg.value || "HS256";
    header.alg = algorithm;
    const signingInput = `${SecurityInspectorCodec.toBase64Url(JSON.stringify(header))}.${SecurityInspectorCodec.toBase64Url(JSON.stringify(payload))}`;
    let signature = "";
    if (algorithm !== "none") {
      const key = await importInspectorHmacKey(inspectorJwtSecret.value, algorithm);
      const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, SecurityInspectorCodec.utf8Bytes(signingInput)));
      signature = SecurityInspectorCodec.bytesToBase64(bytes).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    }
    inspectorJwtToken.value = `${signingInput}.${signature}`;
    decodeInspectorJwt(inspectorJwtToken.value);
    setSecurityInspectorStatus(algorithm === "none" ? "Unsigned JWT encoded" : `${algorithm} JWT signed locally`, algorithm === "none" ? "error" : "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

export async function verifyInspectorJwt() {
  try {
    const parsed = SecurityInspectorCodec.parseJwt(inspectorJwtToken.value);
    const algorithm = String(parsed.header.alg || "");
    if (!/^HS(?:256|384|512)$/.test(algorithm)) throw new Error("Verification currently supports HMAC JWTs: HS256, HS384, and HS512");
    const key = await importInspectorHmacKey(inspectorJwtSecret.value, algorithm);
    const verified = await crypto.subtle.verify("HMAC", key, SecurityInspectorCodec.base64UrlToBytes(parsed.signature), SecurityInspectorCodec.utf8Bytes(parsed.signingInput));
    renderInspectorJwtAnalysis(parsed, verified ? "signature valid" : "signature invalid");
    setSecurityInspectorStatus(verified ? "JWT signature is valid for the supplied secret" : "JWT signature does not match the supplied secret", verified ? "success" : "error");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

export function loadInspectorCookieSource(source) {
  const raw = source === "response" ? securityResponseEditor?.value || "" : securityRequestEditor?.value || "";
  const header = source === "response" ? "set-cookie" : "cookie";
  const values = SecurityInspectorCodec.extractHeaderValues(raw, header);
  inspectorCookieInput.value = values.join(source === "response" ? "\n" : "; ");
  if (values.length) analyzeInspectorCookies();
  else setSecurityInspectorStatus(`No ${header} header found`, "error");
}

export function analyzeInspectorCookies() {
  try {
    const rows = SecurityInspectorCodec.parseCookies(inspectorCookieInput.value);
    if (!rows.length) throw new Error("No cookie name/value pairs found");
    inspectorCookieResults.className = "inspector-analysis";
    inspectorCookieResults.innerHTML = `<strong>${rows.length} cookie${rows.length === 1 ? "" : "s"}</strong><table class="inspector-cookie-table"><thead><tr><th>Name</th><th>Decoded value</th><th>Attributes / analysis</th></tr></thead><tbody>${rows.map((row) => `<tr><td title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</td><td title="${escapeHtml(row.decodedValue)}">${escapeHtml(row.decodedValue)}</td><td class="${row.notes.length ? "warning" : ""}">${escapeHtml([...Object.entries(row.attributes).map(([name, value]) => `${name}${value === true ? "" : `=${value}`}`), ...row.notes].join(" · ") || "—")}</td></tr>`).join("")}</tbody></table>`;
    setSecurityInspectorStatus("Cookie values and attributes analyzed locally", "success");
  } catch (error) { setSecurityInspectorStatus(error.message, "error"); }
}

export async function copyInspectorValue(value, label) {
  if (!value) { setSecurityInspectorStatus(`Nothing to copy from ${label}`, "error"); return; }
  await navigator.clipboard.writeText(value);
  setSecurityInspectorStatus(`${label} copied`, "success");
}
