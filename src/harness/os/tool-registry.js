/* Workspace and operating-system tool groups shared by the main and renderer runtimes. */

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
    "patch_file",
    "replace_in_file",
    "insert_in_file",
    "append_file",
    "delete_file",
  ]);

  // Keep the model-facing edit surface small. The other mutations remain available
  // for compatibility with parsed responses and older projects.
  const DEFAULT_MUTATIONS = Object.freeze([
    "create_file",
    "patch_file",
    "delete_file",
  ]);

  const PLAN_FILE_TOOLS = Object.freeze([
    "create_file",
  ]);

  const EXECUTION = Object.freeze([
    "run_command",
    "start_process",
    "read_process",
    "stop_process",
  ]);

  const ALL = Object.freeze([...READ_ONLY, ...MUTATIONS, ...EXECUTION]);

  return Object.freeze({
    id: "os",
    label: "Workspace & OS",
    ALL,
    READ_ONLY,
    DEFAULT_READ_ONLY,
    MUTATIONS,
    DEFAULT_MUTATIONS,
    PLAN_FILE_TOOLS,
    EXECUTION,
  });
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = XekuteOsTools;
}

globalThis.XekuteOsTools = XekuteOsTools;
