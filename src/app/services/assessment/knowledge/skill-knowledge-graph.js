"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const crypto = require("node:crypto");
const { redactSecrets } = require("../../../../shared/secret-redaction.js");

const MAX_BODY_CHARS = 16_000;
const MAX_RESULT_CHARS = 24_000;

function clean(value, maximum = 8_000) { return redactSecrets(String(value == null ? "" : value).replace(/\u0000/g, "").trim()).slice(0, maximum); }
function stableId(value) { return `skill:${crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24)}`; }
function normalizeSkillId(value) { return clean(value, 160).toLowerCase().replace(/\.md$/i, "").replace(/\\/g, "/").split("/").pop().replace(/[^a-z0-9._-]+/g, "_"); }
function parseScalar(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    try { return JSON.parse(raw.replace(/'/g, '"')); } catch { return raw.slice(1, -1).split(",").map((item) => clean(item, 160)).filter(Boolean); }
  }
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === "true";
  return raw.replace(/^['"]|['"]$/g, "");
}

function parseFrontmatter(source) {
  const text = String(source || "");
  if (!text.startsWith("---")) return { metadata: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { metadata: {}, body: text, error: "Frontmatter is not terminated by a closing --- line." };
  const header = text.slice(3, end).replace(/^\r?\n/, "");
  const body = text.slice(end + 4).replace(/^\r?\n/, "");
  const metadata = {};
  let listKey = "";
  let mcpEntry = null;
  let toolEntry = null;
  for (const line of header.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = (line.match(/^\s*/) || [""])[0].length;
    const match = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    const listMatch = line.match(/^\s*-\s*(?:(\w+):\s*)?(.*?)\s*$/);
    if (listMatch && indent >= 2) {
      const key = listMatch[1];
      const value = listMatch[2];
      if (key === "server" && indent <= 4 && (listKey === "mcp" || mcpEntry)) {
        mcpEntry = { server: clean(value, 160), tools: [] };
        metadata.mcp.push(mcpEntry);
        toolEntry = null;
        listKey = "mcp";
        continue;
      }
      if (mcpEntry && indent >= 6 && key === "name") {
        toolEntry = { name: clean(value, 160), modes: [], target_types: [], target_arguments: [], access: "" };
        mcpEntry.tools.push(toolEntry);
      } else if (mcpEntry && indent >= 6 && key) {
        if (toolEntry) toolEntry[key] = parseScalar(value);
      } else if (listKey) {
        if (!Array.isArray(metadata[listKey])) metadata[listKey] = [];
        metadata[listKey].push(parseScalar(key ? value : listMatch[2]));
      }
      continue;
    }
    if (!match) continue;
    const [, key, rawValue] = match;
    if (mcpEntry && toolEntry && indent >= 8 && key !== "server" && rawValue) {
      toolEntry[key] = parseScalar(rawValue);
      listKey = "tools";
      continue;
    }
    if (key === "mcp") {
      metadata.mcp = [];
      listKey = "mcp";
      mcpEntry = null;
      toolEntry = null;
      continue;
    }
    if (rawValue) {
      metadata[key] = parseScalar(rawValue);
      listKey = "";
      if (key === "server" && mcpEntry) mcpEntry.server = clean(rawValue, 160);
      continue;
    }
    if (["aliases", "related_skills", "related", "modes", "target_types", "target_arguments"].includes(key)) {
      metadata[key] = [];
      listKey = key;
      continue;
    }
    if (key === "tools" && mcpEntry) {
      mcpEntry.tools = [];
      listKey = "tools";
      toolEntry = null;
      continue;
    }
    metadata[key] = "";
    listKey = "";
  }
  return { metadata, body };
}

function normalizeMcpMappings(metadata = {}) {
  const mappings = [];
  for (const entry of Array.isArray(metadata.mcp) ? metadata.mcp : []) {
    if (!entry || typeof entry !== "object") continue;
    const server = clean(entry.server, 160);
    const tools = (Array.isArray(entry.tools) ? entry.tools : []).map((tool) => {
      const value = tool && typeof tool === "object" ? tool : { name: tool };
      return {
        name: clean(value.name, 160),
        modes: (Array.isArray(value.modes) ? value.modes : []).map((mode) => clean(mode, 40)).filter(Boolean),
        access: value.access === "mutate" ? "mutate" : "read",
        access_declared: value.access === "read" || value.access === "mutate",
        target_types: (Array.isArray(value.target_types) ? value.target_types : []).map((item) => clean(item, 80)).filter(Boolean),
        target_arguments: (Array.isArray(value.target_arguments) ? value.target_arguments : []).map((item) => clean(item, 120)).filter(Boolean),
      };
    }).filter((tool) => tool.name);
    mappings.push({ server, tools, incomplete: !server || !tools.length });
  }
  return mappings;
}

function normalizeEntry(filePath, root, source) {
  const parsed = parseFrontmatter(source);
  const relative = pathDefault.relative(root, filePath).replace(/\\/g, "/");
  const stem = normalizeSkillId(pathDefault.basename(filePath));
  const metadata = parsed.metadata || {};
  const aliases = [...new Set([stem, ...(Array.isArray(metadata.aliases) ? metadata.aliases : [])].map(normalizeSkillId).filter(Boolean))];
  return {
    id: stem,
    stableId: stableId(relative),
    title: clean(metadata.title || stem.replace(/[_-]+/g, " "), 240),
    phase: clean(metadata.phase || "general", 120).toLowerCase(),
    aliases,
    relatedSkills: [...new Set([...(Array.isArray(metadata.related_skills) ? metadata.related_skills : []), ...(Array.isArray(metadata.related) ? metadata.related : [])].map(normalizeSkillId).filter(Boolean))].slice(0, 50),
    mcp: normalizeMcpMappings(metadata),
    source: relative,
    body: clean(parsed.body, MAX_BODY_CHARS),
    sourceHash: crypto.createHash("sha256").update(String(source || "")).digest("hex"),
    metadataError: !String(source || "").startsWith("---") ? "Skill Markdown must begin with restricted YAML frontmatter." : parsed.error || "",
  };
}

function validateEntry(entry) {
  const errors = [];
  if (!entry?.id) errors.push("missing skill id");
  if (!entry?.title) errors.push("missing title");
  if (!entry?.phase) errors.push("missing phase");
  if (entry?.metadataError) errors.push(entry.metadataError);
  return errors;
}

function walkMarkdown(fs, path, root, folder = root, output = []) {
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    const target = path.join(folder, entry.name);
    if (entry.isDirectory()) walkMarkdown(fs, path, root, target, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) output.push(target);
  }
  return output;
}

function createSkillKnowledgeGraph({ fs = fsDefault, path = pathDefault, libraryRoot = path.resolve(__dirname, "../../../../prompts/skills"), mcpRuntime = null } = {}) {
  let entries = null;
  let error = null;
  function load() {
    if (entries) return entries;
    const loaded = [];
    const seen = new Set();
    try {
      for (const filePath of walkMarkdown(fs, path, libraryRoot)) {
        const entry = normalizeEntry(filePath, libraryRoot, fs.readFileSync(filePath, "utf8"));
        const validation = validateEntry(entry);
        if (validation.length) { error = `${entry.source}: ${validation.join("; ")}`; continue; }
        if (seen.has(entry.id)) { error = `Duplicate skill id '${entry.id}'.`; continue; }
        seen.add(entry.id);
        loaded.push(entry);
      }
    } catch (cause) { error = cause.message; }
    entries = loaded.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }
  function find(input = {}) {
    const all = load();
    const exact = normalizeSkillId(input.skill || "");
    if (exact) return all.filter((entry) => entry.id === exact || entry.aliases.includes(exact));
    const phase = clean(input.phase || "", 120).toLowerCase();
    const query = clean(input.query || "", 4_000).toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 24);
    return all.map((entry) => {
      const haystack = `${entry.id} ${entry.title} ${entry.phase} ${entry.aliases.join(" ")} ${entry.body}`.toLowerCase();
      const score = (phase && entry.phase === phase ? 10 : 0) + terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { entry, score };
    }).filter((item) => (!phase || item.entry.phase === phase) && (!terms.length || item.score > 0)).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).map((item) => item.entry);
  }
  function query(input = {}, context = {}) {
    if (!input.skill && !input.phase && !input.query) return { ok: false, error: "query_knowledge requires skill, phase, or query.", code: "KNOWLEDGE_QUERY_REQUIRED" };
    const limit = Math.max(1, Math.min(Number(input.limit) || 10, 30));
    const offset = Math.max(0, Math.min(Number(input.offset) || 0, 100_000));
    const matches = find(input);
    const candidates = matches.slice(offset, offset + limit);
    const selected = [];
    let projectedSize = 0;
    let consumedCandidates = 0;
    for (const entry of candidates) {
      // Decide whether an entry fits before activating any of its MCP
      // mappings. Activation may connect to a server, so an entry that cannot
      // be returned must never trigger that side effect.
      const size = JSON.stringify({
        id: entry.id,
        stableId: entry.stableId,
        title: entry.title,
        phase: entry.phase,
        aliases: entry.aliases,
        relatedSkills: entry.relatedSkills,
        methodology: entry.body,
        prerequisites: extractSectionLines(entry.body, "prerequisites"),
        workflow: extractSectionLines(entry.body, "workflow"),
        evidence: extractSectionLines(entry.body, "evidence to collect"),
        verification: extractSectionLines(entry.body, "verification rules"),
        stopping: extractSectionLines(entry.body, "stop conditions"),
        mcpServers: entry.mcp.map((mapping) => mapping.server),
        activeMcpTools: [],
        unavailableMcp: [],
        source: entry.source,
        sourceHash: entry.sourceHash,
      }).length;
      if (size > MAX_RESULT_CHARS) {
        consumedCandidates += 1;
        continue;
      }
      if (selected.length && projectedSize + size > MAX_RESULT_CHARS) break;
      selected.push(entry);
      projectedSize += size;
      consumedCandidates += 1;
    }
    const build = (activations) => {
      const items = [];
      const activeTools = [];
      const unavailable = [];
      let used = 0;
      for (let index = 0; index < selected.length; index += 1) {
        const entry = selected[index];
        const activated = activations[index] || { ok: true, tools: [], unavailable: [] };
      const item = {
        id: entry.id,
        stableId: entry.stableId,
        title: entry.title,
        phase: entry.phase,
        aliases: entry.aliases,
        relatedSkills: entry.relatedSkills,
        methodology: entry.body,
        prerequisites: extractSectionLines(entry.body, "prerequisites"),
        workflow: extractSectionLines(entry.body, "workflow"),
        evidence: extractSectionLines(entry.body, "evidence to collect"),
        verification: extractSectionLines(entry.body, "verification rules"),
        stopping: extractSectionLines(entry.body, "stop conditions"),
        mcpServers: entry.mcp.map((mapping) => mapping.server),
        activeMcpTools: (activated.tools || []).map((tool) => tool?.function?.name).filter(Boolean).slice(0, 50),
        unavailableMcp: (activated.unavailable || []).slice(0, 20).map((item) => ({
          server: item?.server,
          tool: item?.tool,
          code: item?.code,
          exposedName: item?.exposedName,
        })),
        source: entry.source,
        sourceHash: entry.sourceHash,
      };
      const size = JSON.stringify(item).length;
      if (used + size > MAX_RESULT_CHARS) break;
      used += size;
      items.push(item);
      // Expose leases only for entries that actually made it into the
      // bounded packet. This keeps an omitted oversized result from silently
      // activating MCP tools for the chat.
      activeTools.push(...(activated.tools || []).slice(0, Math.max(0, 50 - activeTools.length)));
      unavailable.push(...(activated.unavailable || []).slice(0, 20));
      }
      const sources = items.map((item) => item.source);
      const totalMatches = matches.length;
      const hasMore = offset + consumedCandidates < totalMatches;
      return {
        ok: true,
        level: 1,
        domain: "knowledge",
        exact: Boolean(input.skill),
        items,
        sources,
        activeTools,
        unavailableMcp: unavailable,
        hasMore,
        pagination: { offset, limit, returned: items.length, total: totalMatches, nextOffset: hasMore ? offset + consumedCandidates : null },
        tokenAccounting: { maxChars: MAX_RESULT_CHARS, usedChars: used, estimatedTokens: Math.ceil(used / 4) },
        error: error || undefined,
      };
    };
    if (context.activateMcp === false || !mcpRuntime?.activate || !selected.some((entry) => entry.mcp.length)) return build(selected.map(() => ({ ok: true, tools: [], unavailable: [] })));
    return Promise.all(selected.map((entry) => mcpRuntime.activate({ workspace: context.workspace, mode: context.mode, mappings: entry.mcp, sessionId: context.sessionId }).catch((cause) => ({ ok: false, tools: [], unavailable: [{ code: cause.code || "MCP_ACTIVATION_FAILED", error: clean(cause.message || "MCP activation failed", 800) }] })))).then(build);
  }
  function extractSection(body, heading) {
    const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, "im");
    return clean(body.match(pattern)?.[1] || "", 2_000);
  }
  function extractSectionLines(body, heading) {
    const wanted = String(heading || "").trim().toLowerCase();
    const lines = String(body || "").split(/\r?\n/);
    const start = lines.findIndex((line) => /^##\s+/.test(line) && line.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
    if (start < 0) return "";
    const collected = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/.test(lines[index])) break;
      collected.push(lines[index]);
    }
    return clean(collected.join("\n"), 2_000);
  }
  function invalidate() { entries = null; error = null; }
  function list() { return load().map((entry) => ({ id: entry.id, title: entry.title, phase: entry.phase, aliases: entry.aliases, source: entry.source, mcpServers: entry.mcp.map((mapping) => mapping.server) })); }
  function validation() {
    load();
    return { ok: !error, error: error || "", skills: entries ? entries.length : 0 };
  }
  return Object.freeze({ load, query, list, invalidate, validation, parseFrontmatter, normalizeEntry });
}

module.exports = { createSkillKnowledgeGraph, parseFrontmatter, normalizeSkillId, normalizeEntry, stableId };
