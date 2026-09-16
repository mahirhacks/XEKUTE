/* Hidden last-line continue signal. Silence means the reply is the final answer. */

(function exposeContinueIntent(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContinueIntent = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const CONTINUE_LINE_RE = /^(?:continue)[.!]?\s*$/i;

  function lastNonEmptyLineIndex(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (String(lines[index] || "").trim()) return index;
    }
    return -1;
  }

  function parse(text) {
    const raw = String(text || "");
    const lines = raw.split(/\r?\n/);
    const index = lastNonEmptyLineIndex(lines);
    if (index < 0) return { continue: false, text: raw };
    if (!CONTINUE_LINE_RE.test(String(lines[index] || "").trim())) return { continue: false, text: raw };
    const kept = lines.slice(0, index);
    while (kept.length && !String(kept[kept.length - 1] || "").trim()) kept.pop();
    return { continue: true, text: kept.join("\n") };
  }

  function strip(text, { streaming = false } = {}) {
    const raw = String(text || "");
    if (!raw) return "";
    if (streaming) {
      const lines = raw.split(/\r?\n/);
      const last = String(lines[lines.length - 1] || "");
      if (!CONTINUE_LINE_RE.test(last.trim())) return raw;
      if (lastNonEmptyLineIndex(lines) !== lines.length - 1) return raw;
    }
    return parse(raw).text;
  }

  return { CONTINUE_LINE_RE, parse, strip };
});
