/* Progressive-disclosure router for prompt depth, context, tools, and cyber guidance. */

(function exposeContextRouter(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContextRouter = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SOCIAL_RE = /^\s*(?:hi|hello|hey|yo|hiya|sup|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ok(?:ay)?|cool|nice)[!.?\s]*$/i;
  const FOLLOW_UP_RE = /^\s*(?:continue|go\s+on|proceed|do\s+it|try\s+again|what\s+next|and\s+then|that|this)\b/i;
  const AFFIRMATIVE_FOLLOW_UP_RE = /^\s*(?:yes|yeah|yep|yup|sure|please|go\s+ahead|do\s+that|start|begin|confirm|confirmed)\b/i;
  const ACTION_OFFER_RE = /\b(?:would\s+you\s+like|shall\s+i|want\s+me\s+to|i\s+can|i(?:'ll|\s+will)|let\s+me|next\s+step|begin|start|perform|run|scan|recon|enumerat|inspect|search|map)\b/i;
  const FILE_PATH_RE = /(?:^|\s)[\w.-]+(?:[\\/][\w.@-]+)*\.[a-z0-9]{1,10}\b/i;
  const OS_STRONG_RE = /\b(?:workspace|repository|repo|codebase|source\s+code|file|folder|directory|function|class|module|import|dependency|package\.json|terminal|shell|command|script|refactor|debug|lint|compile|build|unit\s+test|test\s+suite)\b/i;
  const OS_ACTION_RE = /\b(?:implement|fix|edit|update|modify|create|add|remove|delete|rename|move|write|patch|inspect|search|find|read|run|test)\b/i;
  const TECHNICAL_OBJECT_RE = /\b(?:app|application|website|page|component|endpoint|api|database|schema|config|project|code|bug|error|feature|ui|layout|style|css|html|javascript|typescript|python|node|electron)\b/i;
  const NON_FILE_WRITING_RE = /\b(?:write|draft|compose|create)\s+(?:me\s+)?(?:a\s+)?(?:poem|story|message|email|caption|summary|explanation)\b/i;
  const CYBER_RE = /\b(?:cyber|security|pentest|penetration\s+test|bug\s*bounty|vulnerabilit|exploit|recon|enumerat|attack\s+surface|owasp|cve|payload|xss|sql\s*injection|ssrf|csrf|idor|auth(?:entication|orization)?\s*bypass|passive\s+scan|passive\s+recon|\bscan\b|nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f)\b/i;
  const PASSIVE_RECON_RE = /\b(?:passive\s+scan|passive\s+recon|dns\s+enum|subdomain\s+enum|osint)\b/i;
  const ACTIVE_CYBER_RE = /\b(?:scan|probe|pentest|test\s+(?:the\s+)?target|validate|verify\s+(?:the\s+)?vulnerabilit|run\s+(?:nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f)|exploit)\b/i;
  const TARGET_RE = /https?:\/\/|\b(?:target|host|domain|url|ip\s+address|in[- ]scope)\b/i;
  const RESEARCH_RE = /\b(?:search\s+(?:the\s+)?web|look\s+up|browse|latest|current|today|recent|advisory|cve-\d{4}-\d+)\b/i;
  const MAP_RE = /\b(?:assessment\s+map|application\s+map|map\s+(?:node|route|path|evidence|hypothes)|traffic\s+map)\b/i;
  const EVIDENCE_RE = /\b(?:evidence|finding|hypothesis|false\s+positive|verify\s+finding|report|retest|coverage)\b/i;
  const EXECUTION_RE = /\b(?:run|execute|test|build|lint|compile|terminal|command|start|stop|serve)\b/i;
  const LONG_RUNNING_RE = /\b(?:start|stop|serve|server|watch|dev\s+server|background|process)\b/i;
  const MUTATION_RE = /\b(?:implement|fix|edit|update|modify|create|add|remove|delete|rename|move|write|save|patch|replace|append)\b/i;

  function previousActionOffer(history = []) {
    for (let index = (Array.isArray(history) ? history.length : 0) - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message?.role !== "assistant") continue;
      const content = String(message.content || "").trim();
      if (content && ACTION_OFFER_RE.test(content)) return content.slice(0, 4000);
    }
    return "";
  }

  function routeRequest({ text = "", hasWorkspace = false, family = "assist", mode = "agent", history = [] } = {}) {
    const value = String(text || "").trim();
    const social = !value || SOCIAL_RE.test(value);
    const inProject = Boolean(hasWorkspace);
    if (social) {
      return Object.freeze({
        kind: "conversation", promptDepth: "compact", toolCategories: [], osMode: "none", osMutates: false, explicitFile: false, longRunning: false, cyberCapabilities: [],
        includeWorkspaceContext: false, includeWorkspaceDiscovery: false, includeProjectContext: false, includeAuthority: false, includeMemory: false,
        reason: "simple-conversation",
      });
    }

    const affirmative = AFFIRMATIVE_FOLLOW_UP_RE.test(value);
    const inheritedOffer = affirmative ? previousActionOffer(history) : "";
    const requestText = inheritedOffer ? `${value}\n${inheritedOffer}` : value;
    const followUp = FOLLOW_UP_RE.test(value) || Boolean(inheritedOffer);
    const fileSignal = FILE_PATH_RE.test(requestText);
    const osStrong = OS_STRONG_RE.test(requestText) || fileSignal;
    const osRequested = !NON_FILE_WRITING_RE.test(requestText) && (osStrong || (OS_ACTION_RE.test(requestText) && TECHNICAL_OBJECT_RE.test(requestText)) || (FOLLOW_UP_RE.test(value) && hasWorkspace));
    const cyberTopic = CYBER_RE.test(requestText);
    const passiveRecon = PASSIVE_RECON_RE.test(requestText) || (/\bpassive\b/i.test(requestText) && /\b(?:scan|recon|enumerat)\w*\b/i.test(requestText));
    const research = RESEARCH_RE.test(requestText);
    const map = MAP_RE.test(requestText);
    const evidence = EVIDENCE_RE.test(requestText) && (cyberTopic || map || family === "testing");
    const active = !passiveRecon && cyberTopic && ACTIVE_CYBER_RE.test(requestText) && (TARGET_RE.test(requestText) || /\b(?:nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f)\b/i.test(requestText));
    const cyberCapabilities = [
      research && "research",
      map && "map",
      evidence && "evidence",
      passiveRecon && family === "testing" && "active",
      active && "active",
    ].filter(Boolean);
    if (passiveRecon) {
      for (const capability of ["research", "map", "evidence"]) {
        if (!cyberCapabilities.includes(capability)) cyberCapabilities.push(capability);
      }
    } else if (cyberTopic && !cyberCapabilities.length) {
      cyberCapabilities.push("research");
    }
    const cyberToolsRequested = cyberTopic || cyberCapabilities.length > 0;
    const toolCategories = [...new Set([osRequested && "os", cyberToolsRequested && "cyber"].filter(Boolean))];
    const osMode = !osRequested ? "none" : EXECUTION_RE.test(value) ? "execute" : MUTATION_RE.test(value) ? "write" : "read";
    const osMutates = Boolean(osRequested && MUTATION_RE.test(value));
    const kind = cyberTopic ? (osRequested ? "hybrid" : "cyber") : osRequested ? "workspace" : research ? "research" : "conversation";
    const promptDepth = cyberTopic ? "cyber" : osRequested ? "workspace" : "compact";

    return Object.freeze({
      kind,
      promptDepth,
      toolCategories,
      osMode,
      osMutates,
      explicitFile: fileSignal,
      longRunning: Boolean(osRequested && LONG_RUNNING_RE.test(value)),
      cyberCapabilities,
      includeWorkspaceContext: inProject,
      includeWorkspaceDiscovery: Boolean(inProject && (osRequested || map || evidence || followUp || cyberTopic)),
      includeProjectContext: inProject,
      includeAuthority: inProject,
      includeMemory: Boolean(inProject || followUp || osRequested || cyberTopic),
      reason: `${toolCategories.length ? `${kind}:${toolCategories.join("+")}` : `${kind}:no-tools`}${inheritedOffer ? ":follow-up" : ""}`,
      followUp,
      inheritedIntent: Boolean(inheritedOffer),
    });
  }

  return { routeRequest };
});
