"use strict";

const ALLOWED_PROMOTIONS = new Set(["inferred>observed", "inferred>verified", "observed>verified", "verified>disputed"]);

function createGraphPort({ assessmentMap } = {}) {
  async function execute(input, context) {
    if (!assessmentMap) return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Assessment graph is unavailable." };
    if (input.action === "query_nodes") return assessmentMap.mapOverview(context.workspace);
    if (input.action === "query_neighbors") return assessmentMap.mapNeighbors(context.workspace, input.node_id, {});
    if (input.action === "find_paths") return assessmentMap.mapFindPaths(context.workspace, input.from_node, input.to_node, {});
    if (input.action === "add_assertion" || input.action === "attach_evidence") return assessmentMap.mapAnnotateFinding(context.workspace, { id: input.assertion_id, hypothesis: input.assertion_id, evidenceIds: input.evidence_refs, status: input.state || "inferred" });
    if (input.action === "promote_assertion") {
      const from = String(input.from_state || "inferred");
      const to = String(input.state || "observed");
      if (!ALLOWED_PROMOTIONS.has(`${from}>${to}`)) return { ok: false, error: `Graph assertion promotion ${from} -> ${to} is not permitted.`, code: "GRAPH_PROMOTION_INVALID" };
      if (!Array.isArray(input.evidence_refs) || !input.evidence_refs.length) return { ok: false, error: "Graph promotion requires supporting evidence references.", code: "EVIDENCE_REQUIRED" };
      return assessmentMap.mapAnnotateFinding(context.workspace, { id: input.assertion_id, hypothesis: input.assertion_id, evidenceIds: input.evidence_refs, status: to });
    }
    return { ok: false, error: `Unsupported graph action: ${input.action}`, code: "UNKNOWN_ACTION" };
  }
  return Object.freeze({ execute });
}

module.exports = { ALLOWED_PROMOTIONS, createGraphPort };
