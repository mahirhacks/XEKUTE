/* Cybersecurity and assessment tool groups shared by the main and renderer runtimes. */

const XekuteCyberTools = (() => {
  const SECURITY_EXECUTABLES = Object.freeze([
    "amass",
    "burp",
    "commix",
    "dalfox",
    "dirb",
    "ffuf",
    "gobuster",
    "gowitness",
    "hping3",
    "httpx",
    "katana",
    "masscan",
    "metasploit",
    "msfconsole",
    "naabu",
    "nikto",
    "nmap",
    "nuclei",
    "sqlmap",
    "subfinder",
    "testssl",
    "theharvester",
    "traceroute",
    "tracert",
    "wafw00f",
  ]);
  const COMMAND_WRAPPERS = new Set([
    "bash", "cmd", "cmd.exe", "npx", "perl", "powershell", "powershell.exe",
    "pwsh", "pwsh.exe", "python", "python.exe", "python3", "ruby", "sh", "sudo",
    "wsl", "wsl.exe",
  ]);

  function takeCommandToken(value) {
    const input = String(value || "").trimStart();
    const match = input.match(/^"([^"]+)"|^'([^']+)'|^([^\s]+)/);
    if (!match) return null;
    return {
      raw: match[0],
      value: match[1] || match[2] || match[3] || "",
      rest: input.slice(match[0].length),
    };
  }

  function executableName(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .toLowerCase()
      .replace(/\.(?:exe|cmd|bat|py|pl|rb|sh)$/i, "");
  }

  function isSecurityCommand(command) {
    let remaining = String(command || "").trim();
    for (let index = 0; index < 8 && remaining; index += 1) {
      const token = takeCommandToken(remaining);
      if (!token) return false;
      const rawName = String(token.value || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
      const name = executableName(token.value);
      if (SECURITY_EXECUTABLES.includes(name)) return true;
      if (token.value === "--" || token.value.startsWith("-") || COMMAND_WRAPPERS.has(rawName)) {
        remaining = token.rest;
        continue;
      }
      return false;
    }
    return false;
  }

  const RESEARCH = Object.freeze([
    "search_web",
    "fetch_url",
  ]);

  const MAP_READ = Object.freeze([
    "get_map_overview",
    "get_map_node",
    "get_map_neighbors",
    "find_map_paths",
    "search_map_routes",
    "get_map_shared_objects",
    "get_map_evidence",
    "get_map_hypotheses",
  ]);

  const EVIDENCE = Object.freeze([
    "record_hypothesis",
    "ingest_assessment_records",
    "record_finding_candidate",
    "verify_finding_candidate",
    "annotate_map_finding",
  ]);

  const ACTIVE = Object.freeze([
    "run_security_tool",
  ]);

  const READ_ONLY = Object.freeze([...RESEARCH, ...MAP_READ]);
  const ALL = Object.freeze([...READ_ONLY, ...EVIDENCE, ...ACTIVE]);

  return Object.freeze({
    id: "cyber",
    label: "Cybersecurity",
    SECURITY_EXECUTABLES,
    ALL,
    READ_ONLY,
    RESEARCH,
    MAP_READ,
    EVIDENCE,
    ACTIVE,
    isSecurityCommand,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XekuteCyberTools;
}

globalThis.XekuteCyberTools = XekuteCyberTools;
