const fs = require("fs");
const path = require("path");

const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const { classifyAction } = require("../src/application/policies/policy-engine");
const { MODES } = require("../src/application/policies/operating-mode-rules");

const descByName = Object.fromEntries(
  ToolMap.TOOLS.map((tool) => [
    tool.function.name,
    String(tool.function.description || "").replace(/\s+/g, " ").trim(),
  ]),
);

function classify(name) {
  return classifyAction({ toolName: name, args: {} });
}

const UI_AUTHORITY_DEFAULTS = {
  workspaceRead: true,
  workspaceWrite: true,
  workspaceDelete: true,
  commandExecution: true,
  backgroundProcesses: true,
  terminalAccess: true,
  webResearch: true,
  outboundHttp: true,
  proxyInterception: true,
  trafficCapture: true,
  mapBuild: true,
  evidenceManagement: true,
  passiveRecon: true,
  activeRecon: false,
  automatedScanning: false,
  exploitValidation: false,
  customScripts: false,
  sensitiveDataAccess: false,
};

const modes = Object.values(MODES);

let md = "# XEKUTE Agent Tools by Mode and Authority\n\n";
md += "Generated from `src/adapters/tools/core/tool-catalog.js` and `src/application/policies/policy-engine.js`.\n\n";
md += "Chat modes are flat: **Agent**, **Hypothesis**, **Plan**, and **Ask**. Authority is a separate dimension: **Unrestricted**, **Full Authority**, **Ask for Approval**, and **Approve for me**.\n\n";
md += "**Note:** Mode exposure is what the model can *call*. Authority and assessment policy still decide whether a call is allowed, requires approval, or is blocked. Request wording does **not** shrink grants.\n\n";
md += "In **Agent** mode a two-layer catalog always lists every granted tool; only a hot schema set is attached until `load_tool_schemas` expands packs/names (`workspace`, `map`, `evidence`, `active`).\n\n";

md += "## Summary\n\n";
md += "| Metric | Count |\n| --- | ---: |\n";
md += `| Total registered tools | ${ToolMap.TOOLS.length} |\n`;
for (const mode of modes) {
  const names = ToolMap.toolNamesForProfile(mode.key);
  md += `| ${mode.label} (\`${mode.id}\`) | ${names.length} |\n`;
}
md += `| Agent hot schemas | ${ToolMap.hotToolNamesForProfile("agent").length} |\n`;
md += "\n";

md += "### Agent hot schemas\n\n";
md += ToolMap.hotToolNamesForProfile("agent").map((name) => `- \`${name}\``).join("\n");
md += "\n\n";
md += "### Loadable packs\n\n";
for (const pack of ToolMap.LOADABLE_PACK_NAMES) {
  md += `- \`${pack}\`: ${ToolMap.TOOL_PACKS[pack].map((name) => `\`${name}\``).join(", ")}\n`;
}
md += "\n";

md += "## Authority × Agent matrix\n\n";
md += "| Authority | Agent tool access | Scope | Approval |\n| --- | --- | --- | --- |\n";
md += "| `unrestricted` | All OS + all cyber tools | May leave scope | Auto |\n";
md += "| `full` | All OS + all cyber tools | In scope | Auto |\n";
md += "| `ask` | All OS + all cyber tools | In scope | Prompt before sensitive actions |\n";
md += "| `approve` | All OS + all cyber tools | In scope + policy | Recon and ordinary workspace auto-approved; other sensitive cyber needs approval |\n\n";

md += "Hypothesis, Plan, and Ask tool lists do **not** change with Authority.\n\n";

md += "### Authority permission groups\n\n";
md += "Permission defaults below match new-project **XEKUTE Authority** settings (`src/presentation/ui/bootstrap.js`). Super modes `unrestricted`, `full`, and `ask` force every permission on.\n\n";
const groups = [
  ["Workspace", ["workspaceRead", "workspaceWrite", "workspaceDelete", "commandExecution", "backgroundProcesses", "terminalAccess", "customScripts"]],
  ["Network and traffic", ["webResearch", "outboundHttp", "proxyInterception", "trafficCapture", "sensitiveDataAccess"]],
  ["Assessment", ["mapBuild", "evidenceManagement", "passiveRecon"]],
  ["Sensitive testing", ["activeRecon", "automatedScanning", "exploitValidation"]],
];
for (const [title, keys] of groups) {
  md += `**${title}**\n\n`;
  for (const key of keys) {
    md += `- \`${key}\` — default: ${UI_AUTHORITY_DEFAULTS[key] ? "enabled" : "disabled"}\n`;
  }
  md += "\n";
}

md += "## Tools by Chat Mode\n\n";
for (const mode of modes) {
  const names = [...ToolMap.toolNamesForProfile(mode.key)].sort();
  md += `### ${mode.label} (\`${mode.id}\`)\n\n`;
  md += `_${mode.description}_ · capability: \`${mode.capability}\`\n\n`;
  md += "| Tool | Authority permission | Risk / capability |\n| --- | --- | --- |\n";
  for (const name of names) {
    const classification = classify(name);
    md += `| \`${name}\` | \`${classification.authorityPermission || "—"}\` | ${classification.risk} / ${classification.capability} |\n`;
  }
  md += "\n";
}

md += "## Full Tool Catalog\n\n";
md += "| Tool | Category | Description | Authority permission | Active | Exploit |\n| --- | --- | --- | --- | --- | --- |\n";
for (const tool of ToolMap.TOOLS) {
  const name = tool.function.name;
  const meta = ToolMap.TOOL_META[name] || {};
  const classification = classify(name);
  const desc = (descByName[name] || tool.function.description || "").replace(/\|/g, "\\|").slice(0, 120);
  md += `| \`${name}\` | ${meta.category || "—"} | ${desc} | \`${classification.authorityPermission || "—"}\` | ${classification.active ? "yes" : "no"} | ${classification.exploit ? "yes" : "no"} |\n`;
}

md += "\n## Internal / non-model tools\n\n";
md += "- run_custom_script — used by slash-command routing in the main process; not exposed in the model tool schema.\n";

const outPath = path.join(__dirname, "..", "docs", "tools-by-mode-and-authority.md");
fs.writeFileSync(outPath, md);
console.log(`Wrote ${outPath} (${md.split("\n").length} lines)`);
