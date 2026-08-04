/* Shared request-intent rules for the Node agent and browser fallback runtime. */

(function exposeRequestIntentRules(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteRequestIntentRules = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const READ_ONLY_REQUEST_RE = /\b(explain|describe|summari[sz]e|walk\s+me\s+through|teach|understand|what\s+does|how\s+does|why\s+does|review|read|analy[sz]e)\b/i;
  const EDIT_REQUEST_RE = /\b(create|add|update|edit|modify|change|fix|write|implement|build|make|remove|delete|refactor|append|insert|rename|move|revamp|replace)\b/i;
  const WORKSPACE_ACTION_REQUEST_RE = /\b(run|test|execute|diagnose|debug|inspect|search|find|locate|list\s+files?|open\s+files?|look\s+through|grep)\b/i;
  const CHAT_MARKDOWN_REQUEST_RE = /\b(flow\s*chart|flowchart|diagram|mermaid|markdown|\.md|draw|show\s+me|explain|understand|walk\s+me\s+through)\b/i;
  const EXPLICIT_FILE_MUTATION_RE = /\b(create|add|update|edit|modify|change|fix|implement|build|remove|delete|refactor|append|insert|rename|move|save|revamp|replace)\b/i;
  const MULTI_FILE_WEB_REQUEST_RE = /\bhtml\b.*\bcss\b.*\b(?:javascript|js)\b|\b(?:javascript|js)\b.*\bcss\b.*\bhtml\b|\bseparate files?\b/i;
  const MUTATION_REQUEST_RE = EDIT_REQUEST_RE;
  const FILE_PATH_RE = /\b[\w./-]+\.[A-Za-z0-9]+\b/g;
  const SKIP_VERIFICATION_RE = /\b(skip|without|no|do\s+not|don't)\s+(?:tests?|verification|commands?|running)|\bno\s+tests?\b/i;
  const VERIFICATION_FILE_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|sh|ps1|yml|yaml|toml)$/i;
  const EXPLICIT_DELETE_RE = /\b(delete|remove|erase)\b/i;
  const COMMAND_RESPONSE_KEY_RE = /["'](?:command|cmd|shell|script|executable|timeout(?:_seconds|_ms)?)["']\s*:/i;
  const COMMAND_RESPONSE_TOOL_RE = /\b(?:curl|wget|powershell|pwsh|bash|sh|cmd(?:\.exe)?|nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f)\b/i;
  const STRUCTURED_ACTION_RE = /["'](?:tool|action|name)["']\s*:\s*["'](?:run_command|start_process|run_security_tool|write_file|create_file|patch_file|delete_file|record_hypothesis|record_finding_candidate|verify_finding_candidate)["']/i;
  const FILE_COUNT_WORDS = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 });

  function isEditRequest(text, { includeWorkspaceActions = false } = {}) {
    if (!text) return false;
    if (CHAT_MARKDOWN_REQUEST_RE.test(text) && !EXPLICIT_FILE_MUTATION_RE.test(text)) return false;
    if (READ_ONLY_REQUEST_RE.test(text) && !EDIT_REQUEST_RE.test(text)) return false;
    return EDIT_REQUEST_RE.test(text) || (includeWorkspaceActions && WORKSPACE_ACTION_REQUEST_RE.test(text));
  }

  function looksLikeCommandResponse(text) {
    const value = String(text || "").trim();
    if (!value) return false;
    const candidate = value.replace(/^```(?:json|javascript|js|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const objectLike = candidate.startsWith("{") && candidate.endsWith("}");
    return objectLike && (COMMAND_RESPONSE_KEY_RE.test(candidate) || COMMAND_RESPONSE_TOOL_RE.test(candidate) || STRUCTURED_ACTION_RE.test(candidate));
  }

  function looksLikeCommandResponsePrefix(text) {
    const value = String(text || "");
    if (!value.trimStart().startsWith("{") && !/^\s*```(?:json|javascript|js|text)?\b/i.test(value)) return false;
    return COMMAND_RESPONSE_KEY_RE.test(value) || STRUCTURED_ACTION_RE.test(value) || (value.length >= 32 && COMMAND_RESPONSE_TOOL_RE.test(value));
  }

  return {
    READ_ONLY_REQUEST_RE,
    EDIT_REQUEST_RE,
    WORKSPACE_ACTION_REQUEST_RE,
    CHAT_MARKDOWN_REQUEST_RE,
    EXPLICIT_FILE_MUTATION_RE,
    MULTI_FILE_WEB_REQUEST_RE,
    MUTATION_REQUEST_RE,
    FILE_PATH_RE,
    SKIP_VERIFICATION_RE,
    VERIFICATION_FILE_RE,
    EXPLICIT_DELETE_RE,
    COMMAND_RESPONSE_KEY_RE,
    COMMAND_RESPONSE_TOOL_RE,
    STRUCTURED_ACTION_RE,
    FILE_COUNT_WORDS,
    isEditRequest,
    looksLikeCommandResponse,
    looksLikeCommandResponsePrefix,
  };
});
