"use strict";

const path = require("node:path");

function createStatePort({ fs, path: pathModule = path } = {}) {
  function file(context) { return pathModule.join(context.workspace, ".xekute", "state", "unified-state.json"); }
  function load(context) {
    try { return JSON.parse(fs.readFileSync(file(context), "utf8")); } catch { return { version: 1, values: {}, events: [], checkpoints: [] }; }
  }
  function save(context, state) {
    const target = file(context);
    fs.mkdirSync(pathModule.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  async function execute(input, context) {
    const state = load(context);
    if (input.action === "get" || input.action === "query") return { ok: true, value: input.key ? state.values[input.key] : state.values, events: state.events.slice(-50) };
    if (input.action === "set") { state.values[input.key] = input.value; save(context, state); return { ok: true, key: input.key }; }
    if (input.action === "append_event") { state.events.push({ id: `event-${Date.now().toString(36)}`, ...input.event }); state.events = state.events.slice(-500); save(context, state); return { ok: true, event_count: state.events.length }; }
    if (input.action === "checkpoint") { state.checkpoints.push({ id: `checkpoint-${Date.now().toString(36)}`, values: state.values }); state.checkpoints = state.checkpoints.slice(-50); save(context, state); return { ok: true, checkpoint_count: state.checkpoints.length }; }
    return { ok: false, error: `Unsupported state action: ${input.action}`, code: "UNKNOWN_ACTION" };
  }
  return Object.freeze({ execute });
}

module.exports = { createStatePort };
