"use strict";

function createToolAdapter({
  name = "fixture_tool",
  inputSchema = {},
  execute = async input => ({ ok: true, value: input }),
} = {}) {
  return { name, inputSchema, execute };
}

function createGateAdapter({
  name = "fixture_gate",
  evaluate = async () => ({
    moduleName: name,
    decision: "allow",
    terminal: false,
    reason: "fixture decision",
    policyReference: "fixture-policy",
    restrictions: [],
    timestamp: 0,
  }),
} = {}) {
  return { name, evaluate };
}

function createEventRecorder() {
  const events = [];

  function record(event) {
    if (!event || typeof event !== "object" || typeof event.stage !== "string" || event.stage.trim() === "") {
      throw new TypeError("Recorded event must include a non-empty stage");
    }
    const entry = Object.freeze({ ...event, sequence: events.length });
    events.push(entry);
    return entry;
  }

  return Object.freeze({
    record,
    recordStage(stage, payload = {}) {
      return record({ ...payload, stage });
    },
    getEvents() {
      return events.slice();
    },
    clear() {
      events.length = 0;
    },
    assertOrder(expectedStages) {
      if (!Array.isArray(expectedStages)) throw new TypeError("Expected stages must be an array");
      const actualStages = events.map(event => event.stage);
      if (JSON.stringify(actualStages) !== JSON.stringify(expectedStages)) {
        throw new Error(`Event order mismatch: expected ${JSON.stringify(expectedStages)}, got ${JSON.stringify(actualStages)}`);
      }
      return true;
    },
  });
}

module.exports = {
  createToolAdapter,
  createGateAdapter,
  createEventRecorder,
};
