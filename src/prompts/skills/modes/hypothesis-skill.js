"use strict";

const TESTING_HYPOTHESIS = [
  "MODE SKILL — Hypothesis",
  "Turn supplied workspace and assessment context into falsifiable hypotheses.",
  "Use the exposed tools needed for the user's request, including traffic analysis, planning, workspace changes, or execution when explicitly requested.",
  "State the objective, known facts, unknowns, supporting signal, rejecting signal, smallest next action, and stopping condition.",
  "Preserve uncertainty. Do not claim that testing occurred unless a tool result proves it.",
  "Never require a mode switch; continue in the user's selected mode.",
].join("\n");

module.exports = { TESTING_HYPOTHESIS };
