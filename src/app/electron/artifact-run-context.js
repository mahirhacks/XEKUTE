"use strict";

const nodeCrypto = require("node:crypto");
const Artifacts = require("../../domain/artifacts/investigation-artifacts.js");

function fingerprintArtifactRevisions(revisions = {}) {
  const payload = Artifacts.REVISION_KEYS.map((key) => String(revisions?.[key] || "")).join("|");
  return nodeCrypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function artifactSourceRefs({ evidenceSliceInjected = false } = {}) {
  const refs = [".xekute/project_info/index.md", ".xekute/hypotheses.md", ".xekute/checklist.md"];
  if (evidenceSliceInjected) refs.push(".xekute/evidence/index.md");
  return refs;
}

function createFirstAgentTurnTracker() {
  const seen = new Set();
  function keyOf({ sessionId = "", workspace = "" } = {}) {
    return `${sessionId}::${workspace}`;
  }
  function isFirstAgentTurn({ sessionId = "", workspace = "", profileKey = "" } = {}) {
    if (String(profileKey) !== "agent") return false;
    const key = keyOf({ sessionId, workspace });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }
  return Object.freeze({ isFirstAgentTurn });
}

module.exports = {
  fingerprintArtifactRevisions,
  artifactSourceRefs,
  createFirstAgentTurnTracker,
};
