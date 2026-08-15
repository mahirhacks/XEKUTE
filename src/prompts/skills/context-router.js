/* Progressive-disclosure router for prompt depth, context, tools, and cyber guidance. */

(function exposeContextRouter(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContextRouter = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const SOCIAL_RE = /^\s*(?:hi|hello|hey|yo|hiya|sup|good\s+(?:morning|afternoon|evening)|thanks|thank\s+you|ok(?:ay)?|cool|nice)[!.?\s]*$/i;
  const FOLLOW_UP_RE = /^\s*(?:continue|go\s+on|proceed|do\s+it|try\s+again|what\s+next|and\s+then|that|this)\b/i;
  const AFFIRMATIVE_FOLLOW_UP_RE = /^\s*(?:yes|yeah|yep|yup|sure|please|go\s+ahead|do\s+that|start|begin|confirm|confirmed)\b/i;
  const DELEGATED_ACTION_FOLLOW_UP_RE = /^\s*(?:(?:idk|i\s+(?:do\s+not|don'?t)\s+know|(?:do\s+not|don'?t)\s+know|dunno)[,.]?\s*)?(?:just\s+)?(?:do|make|implement|apply|fix|improve|upgrade|update|change|revamp)\b/i;
  const ACTION_OFFER_RE = /\b(?:would\s+you\s+like|shall\s+i|should\s+i|could\s+i|want\s+me\s+to|i\s+can|i(?:'ll|\s+will)|let\s+me|next\s+step|begin|start|perform|run|scan|recon|enumerat|inspect|search|map)\b/i;
  const FILE_PATH_RE = /(?:^|\s)[\w.-]+(?:[\\/][\w.@-]+)*\.[a-z0-9]{1,10}\b/i;
  const OS_STRONG_RE = /\b(?:workspace|repository|repo|codebase|source\s+code|file|folder|directory|function|class|module|import|dependency|package\.json|terminal|shell|command|script|refactor|debug|lint|compile|build|unit\s+test|test\s+suite)\b/i;
  const OS_ACTION_RE = /\b(?:implement|fix|edit|update|modify|create|add|remove|delete|rename|move|write|patch|apply|make|improve|upgrade|enhance|revamp|inspect|search|find|read|run|test)\b/i;
  const TECHNICAL_OBJECT_RE = /\b(?:app|application|website|page|component|endpoint|api|database|schema|config|project|code|bug|error|feature|calculator|ui|layout|style|css|html|javascript|typescript|python|node|electron)\b/i;
  const NON_FILE_WRITING_RE = /\b(?:write|draft|compose|create)\s+(?:me\s+)?(?:a\s+)?(?:poem|story|message|email|caption|summary|explanation)\b/i;
  const CYBER_RE = /\b(?:cyber|security|pentest|penetration\s+test|bug\s*bounty|vulnerabilit|exploit|recon|enumerat|attack\s+surface|owasp|cve|payload|xss|sql\s*injection|ssrf|csrf|idor|auth(?:entication|orization)?\s*bypass|passive\s+scan|passive\s+recon|\bscan\b|nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f|traffsucker|traffic\s*sucker|browser\s+mapp(?:ing|er))\b/i;
  const PASSIVE_RECON_RE = /\b(?:passive\s+scan|passive\s+recon|dns\s+enum|subdomain\s+enum|osint)\b/i;
  const ACTIVE_CYBER_RE = /\b(?:scan|probe|pentest|test\s+(?:the\s+)?target|validate|verify\s+(?:the\s+)?vulnerabilit|run\s+(?:nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f|traffsucker)|exploit)\b/i;
  const SUBAGENT_SPAWN_RE = /\b(?:traffsucker|traffic\s*sucker|(?:spawn|launch|start|run)\s+(?:an?\s+)?(?:traffsucker\s+)?sub[- ]?agent|(?:spawn|launch|start|run)\s+(?:the\s+)?traffsucker|(?:spawn|launch)\s+(?:an?\s+)?agent)\b/i;
  const TARGET_RE = /https?:\/\/|\b(?:target|host|domain|url|ip\s+address|in[- ]scope)\b/i;
  const RESEARCH_RE = /\b(?:search\s+(?:the\s+)?web|look\s+up|browse|latest|current|today|recent|advisory|cve-\d{4}-\d+)\b/i;
  const MAP_RE = /\b(?:assessment\s+map|application\s+map|map\s+(?:node|route|path|evidence|hypothes)|traffic\s+map|check\s+the\s+map|analyze\s+the\s+map|map\s+analysis)\b/i;
  const MAP_ANALYSIS_RE = /\b(?:check|analyz\w*|inspect|review|explore|travers\w*)\b[\w\s]{0,40}\bmap\b|\bmap\b[\w\s]{0,40}\b(?:check|analyz\w*|inspect|review|overview)\b/i;
  const EVIDENCE_RE = /\b(?:evidence|finding|hypothesis|false\s+positive|verify\s+finding|report|retest|coverage)\b/i;
  const EXECUTION_RE = /\b(?:run|execute|test|build|lint|compile|terminal|command|start|stop|serve)\b/i;
  const LONG_RUNNING_RE = /\b(?:start|stop|serve|server|watch|dev\s+server|background|process)\b/i;
  const MUTATION_RE = /\b(?:implement|fix|edit|update|modify|create|add|remove|delete|rename|move|write|save|patch|replace|append|apply|make|improve|upgrade|enhance|revamp)\b/i;
  const HYPOTHESIS_RE = /\b(?:hypothes\w*|finding\w*|vulnerabilit\w*|false\s+positive|retest\w*|coverage|assess\w*|audit\w*|probe\w*|scan\w*|recon\w*|enumerat\w*|verify\w*|validate\w*)\b/i;

  function previousActionOffer(history = []) {
    const messages = Array.isArray(history) ? history : [];
    const oldestRelevantIndex = Math.max(0, messages.length - 6);
    for (let index = messages.length - 1; index >= oldestRelevantIndex; index -= 1) {
      const message = messages[index];
      const content = String(message.content || "").trim();
      if (!content) continue;
      if (message?.role === "assistant" && ACTION_OFFER_RE.test(content)) return content.slice(0, 4000);
      if (
        message?.role === "user"
        && !NON_FILE_WRITING_RE.test(content)
        && (FILE_PATH_RE.test(content) || OS_STRONG_RE.test(content) || (OS_ACTION_RE.test(content) && TECHNICAL_OBJECT_RE.test(content)))
      ) return content.slice(0, 4000);
    }
    return "";
  }

  function routeRequest({ text = "", hasWorkspace = false, family = "assist", mode = "agent", history = [], activeFile = null } = {}) {
    const value = String(text || "").trim();
    const social = !value || SOCIAL_RE.test(value);
    const inProject = Boolean(hasWorkspace);
    if (social) {
      return Object.freeze({
        kind: "conversation", social: true, promptDepth: "compact", toolCategories: [], osMode: "none", osMutates: false, explicitFile: false, longRunning: false, cyberCapabilities: [],
        includeWorkspaceContext: false, includeWorkspaceDiscovery: false, includeProjectContext: false, includeMemory: false,
        responseRequirements: { evidence: false, interaction: "conversation", reason: "conversation" },
        interactionType: "conversation",
        classification: { type: "conversation", evidence: false, taskBrief: false, reason: "simple-conversation" },
        reason: "simple-conversation",
      });
    }

    const affirmative = AFFIRMATIVE_FOLLOW_UP_RE.test(value);
    const delegatedAction = DELEGATED_ACTION_FOLLOW_UP_RE.test(value);
    const explicitFollowUp = FOLLOW_UP_RE.test(value);
    const inheritedOffer = affirmative || delegatedAction || explicitFollowUp ? previousActionOffer(history) : "";
    const requestText = inheritedOffer ? `${value}\n${inheritedOffer}` : value;
    const followUp = explicitFollowUp || delegatedAction || Boolean(inheritedOffer);
    const fileSignal = FILE_PATH_RE.test(requestText);
    const activeFileSignal = Boolean(activeFile?.path);
    const osStrong = OS_STRONG_RE.test(requestText)
      || fileSignal
      || (activeFileSignal && (MUTATION_RE.test(requestText) || OS_ACTION_RE.test(requestText)));
    const osRequested = !NON_FILE_WRITING_RE.test(requestText) && (osStrong || (OS_ACTION_RE.test(requestText) && TECHNICAL_OBJECT_RE.test(requestText)) || ((explicitFollowUp || delegatedAction) && hasWorkspace));
    const subagentSpawn = SUBAGENT_SPAWN_RE.test(requestText);
    const cyberTopic = CYBER_RE.test(requestText) || subagentSpawn;
    const passiveRecon = PASSIVE_RECON_RE.test(requestText) || (/\bpassive\b/i.test(requestText) && /\b(?:scan|recon|enumerat)\w*\b/i.test(requestText));
    const research = RESEARCH_RE.test(requestText);
    const map = MAP_RE.test(requestText) || MAP_ANALYSIS_RE.test(requestText);
    const assessmentMode = ["agent"].includes(String(mode || "").toLowerCase()) || /:agent$/i.test(String(mode || "")) || family === "testing";
    const evidence = EVIDENCE_RE.test(requestText) && (cyberTopic || map || assessmentMode);
    const requiresEvidence = Boolean(evidence || (passiveRecon && assessmentMode));
    const namedActiveTool = /\b(?:nmap|httpx|gobuster|ffuf|nuclei|sqlmap|katana|subfinder|amass|nikto|testssl|wafw00f|traffsucker)\b/i.test(requestText);
    const active = Boolean(
      subagentSpawn
      || (!passiveRecon && cyberTopic && ACTIVE_CYBER_RE.test(requestText) && (TARGET_RE.test(requestText) || namedActiveTool)),
    );
    const cyberCapabilities = [
      research && "research",
      map && "map",
      evidence && "evidence",
      passiveRecon && assessmentMode && "active",
      active && "active",
      subagentSpawn && "active",
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
    const osMode = !osRequested ? "none" : EXECUTION_RE.test(requestText) ? "execute" : MUTATION_RE.test(requestText) ? "write" : "read";
    const osMutates = Boolean(osRequested && MUTATION_RE.test(requestText));
    const kind = cyberTopic ? (osRequested ? "hybrid" : "cyber") : osRequested ? "workspace" : research ? "research" : "conversation";
    let promptDepth = cyberTopic ? "cyber" : osRequested ? "workspace" : "compact";
    const planningMode = ["plan", "planner"].includes(String(mode || "").toLowerCase()) || /:planner$/i.test(String(mode || ""));
    const hypothesisMode = String(mode || "").toLowerCase() === "hypothesis" || /:hypothesis$/i.test(String(mode || ""));
    if ((planningMode || hypothesisMode) && inProject) {
      promptDepth = assessmentMode || cyberTopic ? "cyber" : "workspace";
    }
    const hypothesisRelated = Boolean(
      requiresEvidence
      || active
      || (cyberTopic && (map || passiveRecon || (TARGET_RE.test(requestText) && HYPOTHESIS_RE.test(requestText))))
      || (assessmentMode && cyberTopic && HYPOTHESIS_RE.test(requestText)),
    );
    const workflowRelated = Boolean(
      !hypothesisRelated
      && (planningMode || osRequested || map || (cyberTopic && (passiveRecon || active))),
    );
    const interactionType = hypothesisRelated ? "hypothesis" : workflowRelated ? "workflow" : "conversation";
    const classificationReason = hypothesisRelated
      ? "evidence-or-hypothesis-request"
      : workflowRelated
        ? "workspace-or-workflow-request"
        : "ordinary-response";

    return Object.freeze({
      kind,
      social,
      promptDepth,
      toolCategories,
      osMode,
      osMutates,
      explicitFile: fileSignal,
      longRunning: Boolean(osRequested && LONG_RUNNING_RE.test(requestText)),
      cyberCapabilities,
      responseRequirements: {
        evidence: requiresEvidence,
        interaction: interactionType,
        reason: requiresEvidence ? "security-or-evidence-request" : classificationReason,
      },
      interactionType,
      classification: { type: interactionType, evidence: hypothesisRelated, taskBrief: workflowRelated, reason: classificationReason },
      includeWorkspaceContext: inProject || planningMode || hypothesisMode,
      includeWorkspaceDiscovery: Boolean(inProject && (planningMode || hypothesisMode || osRequested || map || evidence || followUp || cyberTopic)),
      includeProjectContext: inProject || planningMode || hypothesisMode,
      includeMemory: Boolean(inProject || planningMode || hypothesisMode || followUp || osRequested || cyberTopic),
      reason: `${toolCategories.length ? `${kind}:${toolCategories.join("+")}` : `${kind}:no-tools`}${inheritedOffer ? ":follow-up" : ""}`,
      followUp,
      inheritedIntent: Boolean(inheritedOffer),
    });
  }

  return { routeRequest };
});
