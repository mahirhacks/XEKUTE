"use strict";

/*
 * prompt_builder.js
 *
 * A single human-authored, raw-Markdown source of truth for XEKUTE's model-facing
 * prompt prose lives in src/content/prompts (markdown files). This builder
 * regenerates the exact .js modules under src/content/build that the Node agent
 * and the renderer already consume, so runtime behavior, browser script loading,
 * and tests are unchanged.
 *
 * You edit the .md files, then run:
 *   node src/content/prompt_builder.js
 *
 * NEVER edit the generated .js files directly; they are overwritten.
 *
 * Mapping:
 *   content/prompts/instructs/system_prompt.md     -> content/build/instructs/system_prompt.js
 *   content/prompts/skills/modes/<mode>-skill.md   -> content/build/skills/modes/<mode>-skill.js
 *   content/prompts/skills/libraries/<lib>.md      -> content/build/skills/libraries/<lib>.js
 *
 * Grammar by file kind:
 *   - library  (whole-file prose)           -> module.exports = "<content>";
 *   - mode     (## TESTING / ## ASSIST)     -> module.exports = { TESTING_X, ASSIST_X };
 *   - system   (structured system prompt)   -> module.exports = { ... exact shape ... };
 *
 * System-prompt grammar (see instructs/system_prompt.md):
 *   - Frontmatter  key: value            -> scalar (VERSION, MODULE_ORDER, CLAIM_STATES)
 *   - ## NAME       block                -> string block (COMPACT_ROLE, ROUTING_PROMPT)
 *   - ## NAME       all "key: text"      -> object-lines (COMPACT_MODE_OVERLAYS, MODE_OVERLAYS)
 *   - ## MODULE name                       -> module block (role, evidence, loop, ...)
 *
 * Files under src/prompts/rules/ and src/prompts/guardrail/ contain runtime logic
 * (regexes, state machines, deterministic enforcement) rather than editable prose,
 * so they stay hand-written .js and are NOT generated here.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SRC_ROOT = path.join(__dirname, "..");
const MD_ROOT = path.join(__dirname, "prompts"); // src/content/prompts
const OUT_ROOT = path.join(__dirname, "build"); // src/content/build
const MANIFEST_PATH = path.join(OUT_ROOT, "manifest.json");
const MANIFEST_SCHEMA_VERSION = 1;
const BUILD_VERSION = 1;

const MODE_FILE_NAME = {
  agent: "agent-skill",
  hypothesis: "hypothesis-skill",
  plan: "plan-skill",
  ask: "ask-skill",
};

const LIBRARY_FILE_NAME = [
  "preflight",
  "recon-passive",
  "recon-active",
  "automated-security-scan",
  "header-check",
  "soft-vuln-probing",
  "normal-vuln-probing",
  "deep-vuln-probing",
  "post-vuln-probing",
];

function readTrimmedTail(file) {
  let text = fs.readFileSync(file, "utf8");
  text = text.replace(/\r\n/g, "\n");
  if (text.endsWith("\n")) text = text.slice(0, -1);
  return text;
}

function renderJson(value) {
  return JSON.stringify(value, null, 2);
}

function contentHash(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Library files (whole-file prose string)
// ---------------------------------------------------------------------------
function buildLibraryJs(mdFile) {
  const content = readTrimmedTail(mdFile);
  return `"use strict";\n\n// AUTO-GENERATED from src/content/prompts/skills/libraries/${path.basename(mdFile)}.\n// Edit the .md source and run: node src/content/prompt_builder.js\n\nmodule.exports = ${renderJson(content)};\n`;
}

// ---------------------------------------------------------------------------
// Mode skill files (## TESTING / ## ASSIST sections)
// ---------------------------------------------------------------------------
function buildModeJs(mdFile, exportPrefix) {
  const text = readTrimmedTail(mdFile);
  const sections = {};
  const headerRe = /^(?:#{1,3})\s*(TESTING|ASSIST)\s*$/gm;
  const boundaries = [];
  let match;
  while ((match = headerRe.exec(text)) !== null) {
    boundaries.push({ key: match[1], index: match.index });
  }
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i];
    const contentStart = text.indexOf("\n", start.index) + 1;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    sections[start.key] = text.slice(contentStart, end).trim();
  }
  if (!sections.TESTING && !sections.ASSIST) {
    throw new Error(`Mode file ${mdFile} has no "## TESTING" or "## ASSIST" sections.`);
  }
  const lines = [
    '"use strict";',
    "",
    `// AUTO-GENERATED from src/content/prompts/skills/modes/${path.basename(mdFile)}.`,
    "// Edit the .md source and run: node src/content/prompt_builder.js",
    "",
    `const TESTING_${exportPrefix} = ${renderJson(sections.TESTING || "")};`,
    "",
    `const ASSIST_${exportPrefix} = ${renderJson(sections.ASSIST || "")};`,
    "",
    `module.exports = { TESTING_${exportPrefix}, ASSIST_${exportPrefix} };`,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// System prompt (structured)
// ---------------------------------------------------------------------------
const STRING_BLOCK_NAMES = new Set(["COMPACT_ROLE", "ROUTING_PROMPT"]);
const OBJECT_BLOCK_NAMES = new Set(["COMPACT_MODE_OVERLAYS", "MODE_OVERLAYS"]);

function parseSystemPrompt(mdFile) {
  const text = readTrimmedTail(mdFile);
  const result = { scalars: {}, strings: {}, objects: {}, modules: {} };

  const lines = text.split("\n");
  const frontmatterRe = /^\s*(?:[-*]\s*)?([A-Z_]+)\s*:\s*(.+)$/;

  // Frontmatter scalars sit above the first heading.
  for (const line of lines) {
    if (/^#/.test(line)) break;
    const fm = frontmatterRe.exec(line);
    if (fm && ["VERSION", "MODULE_ORDER", "CLAIM_STATES"].includes(fm[1])) {
      result.scalars[fm[1]] = fm[2].trim();
    }
  }

  let block = null; // { type, name, lines } for string; { type, name, map } for object
  const close = () => { block = null; };

  for (const line of lines) {
    const moduleDir = /^(?:#{1,3})\s*MODULE\s+([a-z-]+)\s*$/i.exec(line);
    if (moduleDir) {
      close();
      block = { type: "module", name: moduleDir[1], lines: [] };
      result.modules[block.name] = block.lines;
      continue;
    }

    const heading = /^(?:#{1,3})\s*([A-Z_]+)\s*$/.exec(line);
    if (heading) {
      close();
      const name = heading[1];
      if (OBJECT_BLOCK_NAMES.has(name)) {
        block = { type: "object", name, map: {} };
        result.objects[name] = block.map;
      } else {
        block = { type: "string", name, lines: [] };
        result.strings[name] = block.lines;
      }
      continue;
    }

    if (!block) continue;

    if (block.type === "object") {
      const kv = /^\s*([a-z-]+)\s*:\s*(.+)$/i.exec(line);
      if (kv) block.map[kv[1]] = kv[2].trim();
    } else if (block.type === "string" || block.type === "module") {
      block.lines.push(line);
    }
  }

  return result;
}

function joinLines(arr) {
  return Array.isArray(arr) ? arr.join("\n").trim() : "";
}

function buildSystemPromptJs(mdFile) {
  const p = parseSystemPrompt(mdFile);
  const version = Number(p.scalars.VERSION) || 1;
  const moduleOrder = (p.scalars.MODULE_ORDER || "role,evidence,loop,failure,feedback,guardrails")
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const claimStates = (p.scalars.CLAIM_STATES || "observed,inferred,hypothesis,verified,rejected,inconclusive,unsupported")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const modules = {};
  for (const key of ["role", "evidence", "loop", "failure", "feedback", "guardrails"]) {
    modules[key] = joinLines(p.modules[key]);
  }

  const out = {
    VERSION: version,
    MODULE_ORDER: moduleOrder,
    CLAIM_STATES: claimStates,
    COMPACT_ROLE: joinLines(p.strings.COMPACT_ROLE),
    ROUTING_PROMPT: joinLines(p.strings.ROUTING_PROMPT),
    COMPACT_MODE_OVERLAYS: p.objects.COMPACT_MODE_OVERLAYS || {},
    MODULES: modules,
    MODE_OVERLAYS: p.objects.MODE_OVERLAYS || {},
  };

  const valueJson = renderJson(out);
  return [
    '"use strict";',
    "",
    "// AUTO-GENERATED from src/content/prompts/instructs/system_prompt.md.",
    "// Edit the .md source and run: node src/content/prompt_builder.js",
    "",
    "(function exposeSystemPrompt(globalScope, factory) {",
    "  const value = factory();",
    '  if (typeof module !== "undefined" && module.exports) module.exports = value;',
    "  if (globalScope) globalScope.XekuteSystemPrompt = value;",
    '})(typeof globalThis !== "undefined" ? globalThis : this, () => (' + valueJson + "));",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
function writeFile(relOut, content) {
  const target = path.join(OUT_ROOT, relOut);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  fs.writeFileSync(target, content, "utf8");
  return { target, changed: previous !== content };
}

function buildCandidates() {
  const candidates = [
    {
      kind: "system",
      logicalName: "system_prompt",
      sourceRel: path.join("instructs", "system_prompt.md"),
      outputRel: path.join("instructs", "system_prompt.js"),
      build: () => buildSystemPromptJs(path.join(MD_ROOT, "instructs", "system_prompt.md")),
    },
  ];

  for (const [mode, fileBase] of Object.entries(MODE_FILE_NAME)) {
    const token = mode === "hypothesis" ? "HYPOTHESIS" : mode === "plan" ? "PLAN" : mode === "ask" ? "ASK" : "AGENT";
    candidates.push({
      kind: "mode",
      logicalName: `${fileBase}`,
      sourceRel: path.join("skills", "modes", `${fileBase}.md`),
      outputRel: path.join("skills", "modes", `${fileBase}.js`),
      build: () => buildModeJs(path.join(MD_ROOT, "skills", "modes", `${fileBase}.md`), token),
    });
  }

  for (const lib of LIBRARY_FILE_NAME) {
    candidates.push({
      kind: "library",
      logicalName: lib,
      sourceRel: path.join("skills", "libraries", `${lib}.md`),
      outputRel: path.join("skills", "libraries", `${lib}.js`),
      build: () => buildLibraryJs(path.join(MD_ROOT, "skills", "libraries", `${lib}.md`)),
    });
  }

  return candidates;
}

function main() {
  const written = [];
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    buildVersion: BUILD_VERSION,
    generatedAt: null, // deterministic output: never used for hashes/filenames
    modules: [],
  };

  const candidates = buildCandidates();
  for (const candidate of candidates) {
    const content = candidate.build();
    const hash = contentHash(content);
    const outputRel = candidate.outputRel.replace(/\.js$/, `-${hash}.js`);
    const writtenEntry = writeFile(outputRel, content);
    written.push({ ...candidate, hash, outputRel, target: writtenEntry.target, changed: writtenEntry.changed });
    manifest.modules.push({
      kind: candidate.kind,
      logicalName: candidate.logicalName,
      source: candidate.sourceRel.replace(/\\/g, "/"),
      hash,
      file: outputRel.replace(/\\/g, "/"),
      exportKind: candidate.kind === "system" ? "global+XekuteSystemPrompt" : "module.exports",
    });
  }

  // Deterministic manifest: stable ordering, no timestamps.
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, manifestJson, "utf8");

  let changed = 0;
  for (const entry of written) {
    if (entry.changed) changed += 1;
    console.log(`[${entry.changed ? "UPDATED" : "unchanged"}] ${entry.target}`);
  }

  console.log(`\nprompt_builder: ${written.length} modules checked, ${changed} regenerated. Manifest: ${MANIFEST_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = { buildSystemPromptJs, buildModeJs, buildLibraryJs, MODE_FILE_NAME, LIBRARY_FILE_NAME, buildCandidates, contentHash, OUT_ROOT, MANIFEST_PATH };
