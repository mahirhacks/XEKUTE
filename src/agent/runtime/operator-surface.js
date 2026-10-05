/* Operator-facing text guard and live-command checkup routing. */

(function exposeOperatorSurface(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteOperatorSurface = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const TOOL_NAMES = [
    "ask_questions",
    "exec_command",
    "view_active_terminal",
    "read_file",
    "search_workspace",
    "apply_patch",
    "manage_identity",
    "replay_request",
    "browser_action",
    "delegate_agent",
    "web_research",
    "end_turn",
  ];
  const TOOL_NAME_RE = new RegExp(`\\b(?:${TOOL_NAMES.join("|")})\\b`, "gi");
  const PROCESS_ID_RE = /\bprocess-[a-z0-9][a-z0-9-]{2,}\b/gi;
  const SCHEMA_WORD_RE = /\b(?:process_id|stdout_offset|stderr_offset|tail_chars|show_in_terminal|inputSchema|input_schema|commandCallId|commandInvocationId|timeout_ms|wait_ms)\b/gi;
  const OPERATION_RE = /\boperation\b\s*[:=]?\s*["']?(?:run|start|status|stop|list)["']?/gi;
  const GLUE = new Set("i i'll ill i'm im the a an to and or with of for on it its it's this that using use used call called calling via by from in is am will going just now let me my so then tool tools function functions schema schemas parameter parameters argument arguments id ids".split(" "));

  function hasOperatorLeak(text) {
    const value = String(text || "");
    TOOL_NAME_RE.lastIndex = 0;
    PROCESS_ID_RE.lastIndex = 0;
    SCHEMA_WORD_RE.lastIndex = 0;
    OPERATION_RE.lastIndex = 0;
    return TOOL_NAME_RE.test(value) || PROCESS_ID_RE.test(value) || SCHEMA_WORD_RE.test(value) || OPERATION_RE.test(value);
  }

  function isHollow(text) {
    const words = String(text || "").toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    return words.every((word) => GLUE.has(word));
  }

  function redactOperatorText(text) {
    const original = String(text || "");
    if (!original) return "";
    const leaked = hasOperatorLeak(original);
    let next = original.replace(/```(?:json|tool|javascript|js)?[^\n]*\n?[\s\S]*?```/gi, (block) => (hasOperatorLeak(block) ? "" : block));
    next = next
      .replace(PROCESS_ID_RE, "")
      .replace(TOOL_NAME_RE, "")
      .replace(SCHEMA_WORD_RE, "")
      .replace(OPERATION_RE, "")
      .replace(/[`"']{2,}/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\s+'s\b/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim();
    if (leaked && isHollow(next)) return "I'll check the process.";
    return next;
  }

  function isProcessCheckupRequest(text) {
    const value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value || value.length > 600) return false;
    if (/\b(?:check\s*up|check up on|check on|look in on)\b/i.test(value)) return true;
    if (/\b(?:check|inspect|review|see)\b.{0,48}\b(?:that|the|this|running)\s+(?:process|command|scan|job)\b/i.test(value)) return true;
    if (/\b(?:how(?:'s| is)|what(?:'s| is))\b.{0,48}\b(?:process|command|scan|job|it doing|it going)\b/i.test(value)) return true;
    if (/\b(?:still running|any (?:new )?output|live output|current output)\b/i.test(value)) return true;
    return false;
  }

  function isLocalProcessProbe(command) {
    const text = String(command || "").trim();
    if (!text) return false;
    if (/\b(?:get-process|get-content|tasklist|pgrep|pidof|openfiles)\b/i.test(text)) return true;
    if (/^\s*(?:ps|top|htop|jobs)(?:\s|$)/i.test(text)) return true;
    if (/\b(?:type|cat|tail|gc|get-content)\b/i.test(text) && /(?:stdout|stderr|process-|durable)/i.test(text)) return true;
    PROCESS_ID_RE.lastIndex = 0;
    if (PROCESS_ID_RE.test(text)) return true;
    return false;
  }

  function shouldReadLiveCommandState({ userMessage = "", tool = {}, running = [] } = {}) {
    const name = String(tool.toolName || tool.action || "");
    if (name !== "exec_command") return false;
    const operation = String(tool.args?.operation || "run");
    if (operation !== "run" && operation !== "start") return false;
    const live = Array.isArray(running) ? running.filter((item) => String(item?.processId || item?.id || "").trim()) : [];
    if (!live.length) return false;
    const command = String(tool.args?.command || tool.args?.executable || "");
    return isProcessCheckupRequest(userMessage) || isLocalProcessProbe(command);
  }

  return {
    TOOL_NAMES,
    redactOperatorText,
    isProcessCheckupRequest,
    isLocalProcessProbe,
    shouldReadLiveCommandState,
  };
});
