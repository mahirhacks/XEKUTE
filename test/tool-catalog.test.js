"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ToolMap = require("../src/adapters/tools/core/tool-catalog");
const OsTools = require("../src/adapters/tools/os/tool-registry");
const CyberTools = require("../src/adapters/tools/cyber/tool-registry");
const { estimateTokenCount } = require("../src/adapters/llm/context-budget");
const InitialPrompts = require("../src/prompts/instructs/initial_prompt");
const { classifyAction } = require("../src/application/policies/policy-engine");

test("catalog snapshot: tool names, packs, groups, and hot set are stable", () => {
  // Compatibility snapshot of the canonical tool surface. Changes here are
  // intentional contract changes and must be reviewed.
  assert.deepEqual(ToolMap.TOOL_NAMES, [
    "find_files", "list_files", "inspect_workspace", "read_file", "read_files",
    "write_file", "create_file", "create_guidance", "request_operator_questions",
    "load_tool_schemas", "patch_file", "replace_in_file", "insert_in_file",
    "append_file", "delete_file", "index_workspace", "search_code", "search_web",
    "fetch_url", "get_file_outline", "get_map_overview", "get_map_node",
    "get_map_neighbors", "find_map_paths", "search_map_routes",
    "get_map_shared_objects", "get_map_evidence", "get_map_hypotheses",
    "annotate_map_finding", "record_hypothesis", "ingest_assessment_records",
    "list_datasets", "run_security_tool", "run_traffsucker",
    "record_finding_candidate", "verify_finding_candidate", "run_command",
    "start_process", "read_process", "stop_process",
  ]);
  assert.deepEqual(ToolMap.LOADABLE_PACK_NAMES, ["workspace", "map", "evidence", "active"]);
  assert.deepEqual(Object.keys(ToolMap.TOOL_PACKS).sort(), ["active", "evidence", "map", "workspace"]);
  assert.ok(ToolMap.TOOL_GROUPS.os && ToolMap.TOOL_GROUPS.cyber, "catalog consumes both registry groups");
  assert.ok(ToolMap.AGENT_HOT_TOOLS.includes("run_command"), "hot tools include run_command");
  assert.equal(ToolMap.AGENT_HOT_TOOLS.includes("run_traffsucker"), false, "traffsucker is catalog-only");
});

test("catalog exposes the full canonical export surface with unique names", () => {
  for (const key of ["TOOLS", "TOOL_META", "TOOL_NAMES", "TOOL_GROUPS", "MODE_TOOL_GROUPS", "TOOL_PACKS", "LOADABLE_PACK_NAMES", "AGENT_HOT_TOOLS"]) {
    assert.ok(key in ToolMap, `catalog must export ${key}`);
  }
  assert.equal(new Set(ToolMap.TOOL_NAMES).size, ToolMap.TOOL_NAMES.length, "tool names must be unique");
  assert.ok(ToolMap.TOOL_NAMES.every((name) => ["os", "cyber"].includes(ToolMap.TOOL_META[name]?.category)), "every tool must belong to an explicit category");
  for (const name of ToolMap.TOOL_NAMES) {
    const def = ToolMap.TOOLS.find((tool) => tool.function?.name === name);
    assert.ok(def, `TOOLS must define ${name}`);
    assert.ok(def.function.description, `${name} must have a description`);
  }
});

test("catalog globals preserve logical load order: OS registry before cyber registry before ToolMap", () => {
  assert.ok(OsTools.ALL && OsTools.ALL.length, "OS registry must expose ALL groups");
  assert.ok(CyberTools.ALL && CyberTools.ALL.length, "cyber registry must expose ALL groups");
  assert.ok(CyberTools.isSecurityCommand("nmap -sV example.com"), "security classification must be intact");
  assert.equal(CyberTools.isSecurityCommand("npm run build"), false, "ordinary build must not be security");
  assert.ok(ToolMap.TOOL_GROUPS.os && ToolMap.TOOL_GROUPS.cyber, "catalog must consume both registry groups");
  // The renderer relies on XekuteOsTools < XekuteCyberTools < ToolMap in index.html.
  assert.ok(OsTools.ALL.includes("read_file") && OsTools.ALL.includes("run_command"), "OS registry includes workspace + execution tools");
  assert.ok(CyberTools.READ_ONLY.includes("get_map_overview") && CyberTools.ACTIVE.includes("run_traffsucker"), "cyber registry includes read + active groups");
  assert.deepEqual(ToolMap.TOOL_GROUPS.cyber.isSecurityCommand("nmap -sV example.com"), true);
});

test("agent hot set is a subset of granted tools and includes load_tool_schemas", () => {
  const granted = ToolMap.toolNamesForProfile("agent");
  const hot = ToolMap.hotToolNamesForProfile("agent");
  assert.ok(granted.includes("load_tool_schemas"));
  assert.ok(granted.includes("run_traffsucker"));
  assert.ok(hot.includes("load_tool_schemas"));
  assert.ok(hot.includes("run_command"));
  assert.ok(hot.includes("search_web"));
  assert.equal(hot.includes("run_traffsucker"), false);
  assert.equal(hot.includes("run_security_tool"), false);
  assert.ok(hot.every((name) => granted.includes(name)));
  assert.ok(hot.length < granted.length);
});

test("ask and plan modes still ship full schemas (no lazy layer)", () => {
  assert.deepEqual(ToolMap.hotToolNamesForProfile("ask"), ToolMap.toolNamesForProfile("ask"));
  assert.deepEqual(ToolMap.hotToolNamesForProfile("planner"), ToolMap.toolNamesForProfile("planner"));
  assert.equal(ToolMap.toolNamesForProfile("ask").includes("load_tool_schemas"), false);
});

test("tool catalog lists every granted tool with hot vs catalog markers", () => {
  const catalog = ToolMap.buildToolCatalog("agent");
  assert.ok(catalog.some((entry) => entry.name === "run_traffsucker" && entry.schema === "catalog" && entry.pack === "active"));
  assert.ok(catalog.some((entry) => entry.name === "run_command" && entry.schema === "hot"));
  const rendered = InitialPrompts.toolCatalog(catalog, { packs: ToolMap.LOADABLE_PACK_NAMES });
  assert.match(rendered, /run_traffsucker/);
  assert.match(rendered, /load_tool_schemas/);
  assert.match(rendered, /Loadable packs/);
});

test("resolveSchemaLoad expands active pack within mode grants", () => {
  const allowed = ToolMap.toolNamesForProfile("agent");
  const resolved = ToolMap.resolveSchemaLoad({ allowedNames: allowed, packs: ["active"] });
  assert.equal(resolved.ok, true);
  assert.ok(resolved.loaded.includes("run_traffsucker"));
  assert.ok(resolved.loaded.includes("run_security_tool"));
  assert.ok(resolved.schemas.some((tool) => tool.function.name === "run_traffsucker"));
});

test("resolveSchemaLoad denies tools outside mode grants", () => {
  const resolved = ToolMap.resolveSchemaLoad({
    allowedNames: ToolMap.toolNamesForProfile("ask"),
    names: ["run_traffsucker"],
  });
  assert.equal(resolved.ok, false);
  assert.deepEqual([...resolved.denied], ["run_traffsucker"]);
});

test("load_tool_schemas validates and classifies as read-only", () => {
  const validated = ToolMap.validateToolCall("load_tool_schemas", { packs: ["map"] });
  assert.equal(validated.ok, true);
  const empty = ToolMap.validateToolCall("load_tool_schemas", {});
  assert.equal(empty.ok, false);
  const classification = classifyAction({ toolName: "load_tool_schemas", args: { packs: ["active"] } });
  assert.equal(classification.active, false);
  assert.equal(classification.authorityPermission, "workspaceRead");
});

test("agent hot schemas stay well below a full agent catalog", () => {
  const granted = ToolMap.toolsForProfile("agent");
  const hotNames = new Set(ToolMap.hotToolNamesForProfile("agent"));
  const hot = ToolMap.compactTools(granted.filter((tool) => hotNames.has(tool.function.name)));
  const full = ToolMap.compactTools(granted);
  const hotTokens = estimateTokenCount(JSON.stringify(hot));
  const fullTokens = estimateTokenCount(JSON.stringify(full));
  assert.ok(hotTokens < fullTokens * 0.7, `hot=${hotTokens} full=${fullTokens}`);
  assert.ok(hotTokens < 4500, `hot schemas unexpectedly large: ${hotTokens}`);
});
