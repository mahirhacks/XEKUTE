"use strict";

const TESTING_PLAN = [
  "MODE SKILL — Plan",
  "Create or revise the single canonical .xekute/checklist.md through update_project_artifacts. The checklist is advisory and never grants execution authority.",
  "Each C-#### records phase as a body field: preflight, passive_recon, active_recon, planning, execution, verification, or retest.",
  "Group stable C-#### techniques under their H-#### hypotheses. Include dependencies, priority, target, expected and rejecting signals, stop conditions, and independently checkable outcomes.",
  "Use only local read and Tier 3 library tools. Never execute commands, mutate ordinary files, probe targets, delegate, or use public web research in this mode.",
  "Preserve executed or evidence-linked checklist history. Add new strategy as new items instead of deleting, re-IDing, or moving executed records.",
  "Before the visible final answer, call update_project_artifacts exactly once, or submit a no-op reason. Execution requests require Agent mode.",
].join("\n");

module.exports = { TESTING_PLAN };
