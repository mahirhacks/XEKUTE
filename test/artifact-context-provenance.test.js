"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Artifacts = require("../src/domain/artifacts/investigation-artifacts.js");
const {
  fingerprintArtifactRevisions,
  artifactSourceRefs,
  createFirstAgentTurnTracker,
} = require("../src/app/electron/artifact-run-context.js");

function nine(overrides = {}) {
  return Object.fromEntries(Artifacts.REVISION_KEYS.map((key) => [key, overrides[key] || "a".repeat(64)]));
}

test("source_refs cite the new canonical paths and never leftover files", () => {
  const base = artifactSourceRefs({ evidenceSliceInjected: false });
  assert.deepEqual(base, [".xekute/project_info/index.md", ".xekute/hypotheses.md", ".xekute/checklist.md"]);
  const withEvidence = artifactSourceRefs({ evidenceSliceInjected: true });
  assert.deepEqual(withEvidence, [".xekute/project_info/index.md", ".xekute/hypotheses.md", ".xekute/checklist.md", ".xekute/evidence/index.md"]);
  assert.equal(base.includes(".xekute/project_info.md"), false);
  assert.equal(base.includes(".xekute/investigation_checklist.md"), false);
});

test("first Agent turn tracker is true then false for the same session/workspace pair", () => {
  const tracker = createFirstAgentTurnTracker();
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s1", workspace: "ws", profileKey: "ask" }), false);
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s1", workspace: "ws", profileKey: "hypothesis" }), false);
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s1", workspace: "ws", profileKey: "plan" }), false);
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s1", workspace: "ws", profileKey: "agent" }), true);
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s1", workspace: "ws", profileKey: "agent" }), false);
  assert.equal(tracker.isFirstAgentTurn({ sessionId: "s2", workspace: "ws", profileKey: "agent" }), true);
});

test("record_id fingerprint uses the eight-key revisions object and ignores project_info aggregate", () => {
  const first = fingerprintArtifactRevisions(nine());
  const changed = fingerprintArtifactRevisions(nine({ hypotheses: "b".repeat(64) }));
  const decoy = fingerprintArtifactRevisions({ ...nine(), project_info: "c".repeat(64) });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, changed);
  assert.equal(first, decoy);
  assert.equal(fingerprintArtifactRevisions({ project_info: "c".repeat(64) }), fingerprintArtifactRevisions({}));
});
