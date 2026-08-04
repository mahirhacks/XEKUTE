/* Human-readable defaults and action classification tables. */

const DEFAULT_AUTHORITY_PERMISSIONS = Object.freeze({
  workspaceRead: true, workspaceWrite: true, workspaceDelete: true,
  commandExecution: true, backgroundProcesses: true, terminalAccess: true,
  webResearch: true, outboundHttp: true, proxyInterception: true,
  trafficCapture: true, mapBuild: true, evidenceManagement: true,
  passiveRecon: true, activeRecon: true, automatedScanning: true,
  exploitValidation: true, customScripts: true, sensitiveDataAccess: true,
});

const DEFAULT_POLICY = Object.freeze({
  allowActiveTesting: false,
  allowAutomatedScanning: false,
  allowExploitValidation: false,
  requireApprovalForActive: true,
  maxRequestsPerSecond: 2,
  maxConcurrency: 1,
  requestTimeoutSeconds: 15,
  stopOnUnexpectedImpact: true,
  stopOnOutOfScope: true,
  authoritySuperMode: "approve",
  authorityPermissions: DEFAULT_AUTHORITY_PERMISSIONS,
});

const ACTION_CLASSIFICATION = Object.freeze({
  evidenceTools: Object.freeze(["annotate_map_finding", "record_hypothesis", "record_finding_candidate", "verify_finding_candidate"]),
  mapReadTools: Object.freeze(["get_map_overview", "get_map_node", "get_map_neighbors", "find_map_paths", "search_map_routes", "get_map_shared_objects", "get_map_evidence", "get_map_hypotheses"]),
  workspaceMutationTools: Object.freeze(["write_file", "create_file", "create_guidance", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"]),
  processTools: Object.freeze(["run_command", "start_process", "read_process", "stop_process"]),
  passiveAdapters: Object.freeze(["subfinder", "amass", "theharvester"]),
  exploitAdapters: Object.freeze(["sqlmap"]),
});

const ACTIVE_COMMAND_RE = /\b(?:curl|wget|invoke-webrequest|httpx|nmap|ffuf|gobuster|dirb|katana|subfinder|amass|theharvester|nikto|sqlmap|testssl|gowitness|burp|wafw00f|hping3|traceroute|tracert)\b/i;
const EXPLOIT_COMMAND_RE = /\b(?:sqlmap|metasploit|msfconsole|commix|dalfox|nuclei|xss|payload|exploit|reverse.?shell)\b/i;
const SAFE_WORKSPACE_COMMAND_RE = /^\s*(?:(?:npm|npm\.cmd)\s+(?:test|run\s+(?:test|lint|build|check|typecheck|verify(?::[a-z0-9:_-]+)?|dev|start|serve))|(?:pnpm|pnpm\.cmd|yarn|yarn\.cmd)\s+(?:test|lint|build|check|typecheck|dev|start)|node(?:\.exe)?\s+(?:--test|--check\s+\S+)|git(?:\.exe)?\s+(?:status|diff|log)|(?:python|python\.exe|python3)\s+-m\s+(?:pytest|unittest)|pytest(?:\.exe)?|cargo(?:\.exe)?\s+(?:test|check)|go(?:\.exe)?\s+test|dotnet(?:\.exe)?\s+(?:test|build))(?:\s+[^;&|\r\n]+)?\s*$/i;

module.exports = { DEFAULT_AUTHORITY_PERMISSIONS, DEFAULT_POLICY, ACTION_CLASSIFICATION, ACTIVE_COMMAND_RE, EXPLOIT_COMMAND_RE, SAFE_WORKSPACE_COMMAND_RE };
