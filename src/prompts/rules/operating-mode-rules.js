/* Declarative capabilities for the six public XEKUTE profiles. */

const TESTING_MODES = Object.freeze({
  planner: { family: "testing", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Create a grounded testing plan from supplied context; create plan documents only." },
  agent: { family: "testing", key: "agent", label: "Agent", legacyMode: "agent", capability: "active", description: "Execute, observe, verify, and report within runtime policy." },
  ask: { family: "testing", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Answer from supplied testing evidence with read-only tools." },
});

const ASSIST_ROLES = Object.freeze({
  planner: { family: "assist", key: "planner", label: "Planner", legacyMode: "plan", capability: "plan", description: "Create a grounded plan from supplied context; create plan documents only." },
  agent: { family: "assist", key: "agent", label: "Agent", legacyMode: "agent", capability: "workspace", description: "Execute safe workspace actions while analyzing, observing, verifying, and reporting." },
  ask: { family: "assist", key: "ask", label: "Ask", legacyMode: "ask", capability: "observe", description: "Answer from supplied context with read-only tools." },
});

const READ_ONLY_CAPABILITIES = new Set(["observe", "assess", "plan", "verify", "report"]);

module.exports = { TESTING_MODES, ASSIST_ROLES, READ_ONLY_CAPABILITIES };
