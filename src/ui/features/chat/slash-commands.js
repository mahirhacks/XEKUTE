import { appState } from "../../core/app-state.js";
import { guidanceEntryKind, SYSTEM_SKILL_COMMANDS, composerEl } from "../../bootstrap.js";
import {
  syncChatInputEmptyState, chatInputEditorValue, renderChatInputEditorValue,
  setChatInputCaretToEnd, resizeChatInput, updateSendBtn,
} from "./composer-input.js";
import { slashCommandSuggestions, chatInput, selectedSlashCommandEl } from "../../core/dom-refs.js";
import { syncChatInputPlaceholder } from "./chat-mode.js";
import { isRunningChatActive } from "./chat-run-state.js";
import { addErrorMessage } from "./chat-messages.js";

export const CUSTOM_COMMANDS_KEY = "pointer:customSlashCommands";
export const COMMAND_REGISTRY_KEY = "pointer:commandRegistry";

export const SYSTEM_SKILL_SLASH_COMMANDS = Object.freeze([
  Object.freeze({ name: "/create-rule", title: "Create a project rule", description: "Create a project or global rule", overview: "Create validated Xekute rule guidance through the protected guidance writer.", prompt: "", group: "system-command" }),
  Object.freeze({ name: "/create-skill", title: "Create user guidance skill", description: "Create user-authored guidance", overview: "Create a validated project or global custom guidance skill.", prompt: "", group: "system-command" }),
  Object.freeze({ name: "/create-subagent", title: "Create a subagent profile", description: "Create a bounded subagent profile", overview: "Create a validated project or global specialist-agent profile.", prompt: "", group: "system-command" }),
]);

export const BUG_BOUNTY_COMMANDS = new Set();
export const CUSTOM_SKILL_COMMANDS = new Set();

export function syncCustomSkillSlashCommands(entries = appState.customGuidanceEntries) {
  const seen = new Set();
  appState.customSkillSlashCommands = (Array.isArray(entries) ? entries : [])
    .filter((entry) => guidanceEntryKind(entry) === "skills")
    .sort((left, right) => {
      const leftScope = String(left?.scope || "project") === "project" ? 0 : 1;
      const rightScope = String(right?.scope || "project") === "project" ? 0 : 1;
      return leftScope - rightScope || String(left?.name || "").localeCompare(String(right?.name || ""));
    })
    .map((entry) => ({
      name: String(entry.activation || "").trim().toLowerCase(),
      description: String(entry.summary || `Run the ${entry.name || "custom"} skill.`),
      overview: String(entry.summary || `Run the ${entry.name || "custom"} skill.`),
      prompt: "",
      group: "custom-skill",
    }))
    .filter((command) => command.name
      && /^\/[a-z0-9][a-z0-9_-]*$/.test(command.name)
      && !SYSTEM_SKILL_COMMANDS.has(command.name)
      && !BUG_BOUNTY_COMMANDS.has(command.name)
      && !seen.has(command.name)
      && seen.add(command.name));
  CUSTOM_SKILL_COMMANDS.clear();
  appState.customSkillSlashCommands.forEach((command) => CUSTOM_SKILL_COMMANDS.add(command.name));
  renderSlashSuggestions();
}

export function availableSlashCommands() {
  return [
    ...SYSTEM_SKILL_SLASH_COMMANDS,
    ...appState.bugBountySlashCommands,
    ...appState.customSkillSlashCommands,
    ...customSlashCommands(),
  ];
}

export async function loadBugBountySlashCommands() {
  const result = await window.api?.listSlashCatalog?.().catch(() => null);
  const skills = Array.isArray(result?.skills) ? result.skills : [];
  appState.bugBountySlashCommands = skills
    .filter((skill) => skill?.menu === "bug-bounty" && skill.id)
    .map((skill) => ({
      name: `/${String(skill.id).toLowerCase()}`,
      title: skill.title || skill.id,
      description: skill.description || skill.title || skill.id,
      overview: skill.description || "",
      prompt: "",
      group: "bug-bounty",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  BUG_BOUNTY_COMMANDS.clear();
  appState.bugBountySlashCommands.forEach((command) => BUG_BOUNTY_COMMANDS.add(command.name));
  renderSlashSuggestions();
}
export function customSlashCommands() {
  const commands = [];
  for (const line of (localStorage.getItem(CUSTOM_COMMANDS_KEY) || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(\/[\w-]+)\s*=\s*(.+)$/);
    if (match) commands.push({ name: match[1].toLowerCase(), description: match[2], overview: match[2], prompt: match[2], group: "custom-command" });
  }
  return commands.filter((command, index, all) => all.findIndex((item) => item.name === command.name) === index);
}

export function slashCommandTitle(command) {
  const explicit = String(command?.title || "").trim();
  if (explicit) return explicit;
  return String(command?.name || "Skill")
    .replace(/^\//, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") || "Skill";
}

export function slashCommandOverviewElement() {
  let overview = document.querySelector("#slash-command-overview");
  if (overview) return overview;
  overview = document.createElement("aside");
  overview.id = "slash-command-overview";
  overview.className = "slash-command-overview";
  overview.setAttribute("role", "tooltip");
  overview.hidden = true;
  overview.innerHTML = `<strong></strong><p></p>`;
  document.body.appendChild(overview);
  return overview;
}

export function hideSlashCommandOverview() {
  const overview = document.querySelector("#slash-command-overview");
  if (overview) overview.hidden = true;
  slashCommandSuggestions?.querySelectorAll("[aria-describedby=\"slash-command-overview\"]")
    .forEach((item) => item.removeAttribute("aria-describedby"));
}

export function showSlashCommandOverview(command, anchor) {
  const overview = slashCommandOverviewElement();
  overview.querySelector("strong").textContent = slashCommandTitle(command);
  overview.querySelector("p").textContent = String(command?.overview || command?.description || "Custom skill");
  overview.hidden = false;
  anchor.setAttribute("aria-describedby", overview.id);
  const anchorRect = anchor.getBoundingClientRect();
  const paletteRect = slashCommandSuggestions.getBoundingClientRect();
  const width = overview.offsetWidth || 200;
  const height = overview.offsetHeight || 120;
  const left = paletteRect.left - width - 8 >= 8
    ? paletteRect.left - width - 8
    : Math.max(8, Math.min(window.innerWidth - width - 8, paletteRect.right + 8));
  const top = Math.max(8, Math.min(window.innerHeight - height - 8, anchorRect.top));
  overview.style.left = `${left}px`;
  overview.style.top = `${top}px`;
}

export function closeSlashSuggestions() {
  if (slashCommandSuggestions) slashCommandSuggestions.hidden = true;
  hideSlashCommandOverview();
  appState.slashSuggestionItems = [];
  appState.slashSuggestionIndex = -1;
  appState.slashSuggestionTarget = null;
}

export function reconcileSelectedSlashCommandAfterEdit() {
  const tokenRemoved = appState.selectedSlashCommand && (!selectedSlashCommandEl || !chatInput?.contains(selectedSlashCommandEl));
  const tokenEdited = appState.selectedSlashCommand && selectedSlashCommandEl
    && chatInput?.contains(selectedSlashCommandEl)
    && selectedSlashCommandEl.textContent !== appState.selectedSlashCommand;
  if (tokenRemoved || tokenEdited) {
    appState.selectedSlashCommand = "";
    if (selectedSlashCommandEl) {
      if (tokenRemoved) selectedSlashCommandEl.hidden = true;
      else selectedSlashCommandEl.classList.remove("selected-slash-command");
    }
    composerEl?.classList.remove("has-selected-slash-command");
    syncChatInputPlaceholder();
  }
  syncChatInputEmptyState();
}

export function setSelectedSlashCommand(command = "") {
  const editorText = chatInputEditorValue();
  appState.selectedSlashCommand = String(command || "").trim();
  if (selectedSlashCommandEl) {
    selectedSlashCommandEl.classList.add("selected-slash-command");
    selectedSlashCommandEl.textContent = appState.selectedSlashCommand;
  }
  composerEl?.classList.toggle("has-selected-slash-command", Boolean(appState.selectedSlashCommand));
  renderChatInputEditorValue(editorText);
  syncChatInputPlaceholder();
}

export function clearSelectedSlashCommand({ restoreText = false } = {}) {
  const command = appState.selectedSlashCommand;
  setSelectedSlashCommand("");
  if (restoreText && command && chatInput) {
    const text = chatInput.value.trim();
    chatInput.value = `${command}${text ? ` ${text}` : " "}`;
    setChatInputCaretToEnd();
  }
}

export function slashQueryAtCaret() {
  const selection = window.getSelection?.();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || node.parentNode !== chatInput) return null;
  const match = /(^|\s)\/([\w-]*)$/.exec(node.data.slice(0, selection.anchorOffset));
  return match && { node, start: match.index + match[1].length, end: selection.anchorOffset, query: `/${match[2]}`.toLowerCase() };
}

export function chooseSlashSuggestion(index = appState.slashSuggestionIndex, { clicked = false } = {}) {
  const command = appState.slashSuggestionItems[index];
  const target = appState.slashSuggestionTarget;
  if (!command || !target?.node.isConnected) return false;
  const range = document.createRange();
  range.setStart(target.node, target.start);
  const end = target.start > 0 && target.node.data[target.start - 1] === " " && target.node.data[target.end] === " "
    ? target.end + 1 : target.end;
  range.setEnd(target.node, end);
  range.deleteContents();
  const argumentsText = chatInput.value.trimStart();
  if (clicked) {
    setSelectedSlashCommand(command.name);
    chatInput.value = argumentsText;
  } else {
    clearSelectedSlashCommand();
    chatInput.value = `${command.name} ${argumentsText}`;
  }
  closeSlashSuggestions();
  resizeChatInput(); updateSendBtn(); chatInput.focus();
  setChatInputCaretToEnd();
  return true;
}

export function renderSlashSuggestions() {
  if (!slashCommandSuggestions || isRunningChatActive()) return closeSlashSuggestions();
  const target = slashQueryAtCaret();
  if (!target) return closeSlashSuggestions();
  appState.slashSuggestionTarget = target;
  const query = target.query;
  if (query !== appState.slashSuggestionQuery) {
    appState.slashSuggestionQuery = query;
    appState.bugBountyReveal = 3;
  }
  const groupOrder = { "system-command": 0, "bug-bounty": 1, "custom-skill": 2, "custom-command": 3 };
  const matchingCommands = availableSlashCommands()
    .map((command) => ({ command, score: command.name.startsWith(query) ? 0 : command.name.includes(query.slice(1)) || command.description.toLowerCase().includes(query.slice(1)) ? 1 : 2 }))
    .filter((item) => item.score < 2)
    .sort((a, b) => (groupOrder[a.command.group] ?? 99) - (groupOrder[b.command.group] ?? 99) || a.score - b.score || a.command.name.localeCompare(b.command.name))
    .map((item) => item.command);
  const systemCommands = matchingCommands.filter((command) => command.group === "system-command");
  const bountyCommands = matchingCommands.filter((command) => command.group === "bug-bounty");
  const otherCommands = matchingCommands.filter((command) => command.group !== "system-command" && command.group !== "bug-bounty");
  const visibleBounty = bountyCommands.slice(0, appState.bugBountyReveal);
  const bountyRemaining = bountyCommands.length - visibleBounty.length;
  appState.slashSuggestionItems = [...systemCommands, ...visibleBounty, ...otherCommands];
  if (!appState.slashSuggestionItems.length && bountyRemaining <= 0) return closeSlashSuggestions();
  appState.slashSuggestionIndex = Math.min(Math.max(appState.slashSuggestionIndex, 0), Math.max(appState.slashSuggestionItems.length - 1, 0));
  hideSlashCommandOverview();
  slashCommandSuggestions.innerHTML = "";
  const groupLabels = { "system-command": "System Commands", "bug-bounty": "Bug Bounty Skills", "custom-skill": "Custom Skills", "custom-command": "Commands" };
  let previousGroup = "";
  appState.slashSuggestionItems.forEach((command, index) => {
    if (command.group !== previousGroup) {
      const label = document.createElement("div");
      label.className = "slash-command-group-label";
      label.setAttribute("role", "presentation");
      label.textContent = groupLabels[command.group] || "Commands";
      slashCommandSuggestions.appendChild(label);
      previousGroup = command.group;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slash-command-option${index === appState.slashSuggestionIndex ? " selected" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === appState.slashSuggestionIndex));
    const name = document.createElement("span");
    name.className = "slash-command-name";
    name.textContent = command.name;
    const description = document.createElement("span");
    description.className = "slash-command-description";
    description.textContent = command.description;
    button.append(name, description);
    button.addEventListener("mouseenter", () => showSlashCommandOverview(command, button));
    button.addEventListener("mouseleave", hideSlashCommandOverview);
    button.addEventListener("focus", () => showSlashCommandOverview(command, button));
    button.addEventListener("blur", hideSlashCommandOverview);
    button.addEventListener("mousedown", (event) => { event.preventDefault(); chooseSlashSuggestion(index, { clicked: true }); });
    slashCommandSuggestions.appendChild(button);
    if (command.group === "bug-bounty" && bountyRemaining > 0 && command === visibleBounty.at(-1)) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "slash-command-more";
      const nextCount = Math.min(10, bountyRemaining);
      more.textContent = `Show ${nextCount} more`;
      more.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        appState.bugBountyReveal += nextCount;
        renderSlashSuggestions();
      });
      slashCommandSuggestions.appendChild(more);
    }
  });
  slashCommandSuggestions.hidden = false;
  slashCommandSuggestions.querySelector(".slash-command-option.selected")?.scrollIntoView({ block: "nearest" });
}

export function expandSlashCommand(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("/")) return text;
  const [command, ...rest] = text.split(/\s+/); const args = rest.join(" ");
  if (SYSTEM_SKILL_COMMANDS.has(command.toLowerCase()) || BUG_BOUNTY_COMMANDS.has(command.toLowerCase()) || CUSTOM_SKILL_COMMANDS.has(command.toLowerCase())) return text;
  const override = slashCommandOverrides()[command.toLowerCase()];
  const configuredAiFields = override?.role === "ai" ? [
    override.aim && `Aim: ${override.aim}`,
    override.description && `Description: ${override.description}`,
    override.prompt && `Instructions: ${override.prompt}`,
    override.expectedOutput && `Expected output: ${override.expectedOutput}`,
    override.constraints && `Safety constraints: ${override.constraints}`,
  ].filter(Boolean).join("\n\n") : "";
  const expansion = configuredAiFields || override?.prompt || availableSlashCommands().find((item) => item.name === command.toLowerCase())?.prompt;
  return expansion ? `${expansion}${args ? `\n\nUser parameters: ${args}` : ""}` : text;
}

export function slashCommandOverrides() {
  const raw = localStorage.getItem(COMMAND_REGISTRY_KEY) || "";
  let parsed = {};
  if (raw.trim()) { try { parsed = JSON.parse(raw); } catch { parsed = {}; } }
  if (!parsed || typeof parsed !== "object") parsed = {};
  for (const line of (localStorage.getItem(CUSTOM_COMMANDS_KEY) || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(\/[\w-]+)\s*=\s*(.+)$/);
    if (match && !parsed[match[1].toLowerCase()]) parsed[match[1].toLowerCase()] = { role: "ai", prompt: match[2] };
  }
  return parsed;
}

export async function runSpecialSlashCommand(rawCommand) {
  const command = String(rawCommand || "").trim().split(/\s+/, 1)[0].toLowerCase();
  if (CUSTOM_SKILL_COMMANDS.has(command)) return false;
  const parsed = await window.api.parseSlashCommand({ command: rawCommand, overrides: slashCommandOverrides() });
  if (!parsed?.ok) { addErrorMessage(parsed?.error || "Could not parse slash command."); return true; }
  return false;
}
