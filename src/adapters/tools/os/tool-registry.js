"use strict";

// OS tool group definitions for the renderer and main runtimes.
// This is the canonical group metadata consumed by the tool catalog.
const XekuteOsTools = (() => {
  const READ_ONLY = Object.freeze([
    "find_files",
    "list_files",
    "inspect_workspace",
    "read_file",
    "read_files",
    "index_workspace",
    "search_code",
    "get_file_outline",
  ]);

  const DEFAULT_READ_ONLY = Object.freeze(
    READ_ONLY.filter((name) => name !== "index_workspace"),
  );

  const MUTATIONS = Object.freeze([
    "write_file",
    "create_file",
    "create_guidance",
    "patch_file",
    "replace_in_file",
    "insert_in_file",
    "append_file",
    "delete_file",
  ]);

  const DEFAULT_MUTATIONS = Object.freeze([
    "write_file",
    "create_file",
    "create_guidance",
    "patch_file",
    "delete_file",
  ]);

  const OPERATOR_INTERACTION = Object.freeze([
    "request_operator_questions",
  ]);

  const META = Object.freeze([
    "load_tool_schemas",
  ]);

  const PLAN_FILE_TOOLS = Object.freeze([
    "read_file",
    "write_file",
    "create_file",
    "patch_file",
    ...OPERATOR_INTERACTION,
  ]);

  const EXECUTION = Object.freeze([
    "run_command",
    "start_process",
    "read_process",
    "stop_process",
  ]);

  const ALL = Object.freeze([...READ_ONLY, ...MUTATIONS, ...EXECUTION, ...OPERATOR_INTERACTION, ...META]);

  return Object.freeze({
    id: "os",
    label: "Workspace & OS",
    ALL,
    READ_ONLY,
    DEFAULT_READ_ONLY,
    MUTATIONS,
    DEFAULT_MUTATIONS,
    PLAN_FILE_TOOLS,
    OPERATOR_INTERACTION,
    META,
    EXECUTION,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XekuteOsTools;
}

globalThis.XekuteOsTools = XekuteOsTools;
