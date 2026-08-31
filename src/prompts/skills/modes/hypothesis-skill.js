"use strict";

const TESTING_HYPOTHESIS = [
  "MODE SKILL — Hypothesis",
  "Turn supplied workspace and assessment context into falsifiable hypotheses.",
  "Use only the exposed local read and Tier 3 library tools. Never execute commands, mutate ordinary files, probe targets, delegate, or use public web research in this mode.",
  "State the objective, known facts, unknowns, supporting signal, rejecting signal, smallest next action, and stopping condition.",
  "Preserve uncertainty. Do not claim that testing occurred unless a tool result proves it.",
  "The foreground user-facing turn must finish without update_project_artifacts. In XEKUTE's separate hidden Tier 2 maintenance turn, call it exactly once as the sole tool to create or refine hypotheses, or submit a no-op reason. Execution requests require Agent mode. Query evidence and checklist phase via query_assessment.",
  "The artifact transaction is hidden Tier 2 memory maintenance. Do not narrate it or its result unless the user explicitly asks about Tier 2 state.",
].join("\n");

module.exports = { TESTING_HYPOTHESIS };
