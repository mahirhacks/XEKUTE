"use strict";

/**
 * ToolExecutionPort
 *
 * Dependency-free contract for concrete tool execution and process/terminal
 * lifecycle operations. Application orchestration depends on this port, never on
 * a specific handler implementation, so tests can substitute a fake executor.
 */

const ToolExecutionPort = Object.freeze({
  execute(call, context) { return Promise.resolve({ ok: false, error: "ToolExecutionPort.execute must be injected" }); },
  readProcess(id) { return { ok: false, error: "ToolExecutionPort.readProcess must be injected" }; },
  stopProcess(id) { return { ok: false, error: "ToolExecutionPort.stopProcess must be injected" }; },
});

module.exports = ToolExecutionPort;
