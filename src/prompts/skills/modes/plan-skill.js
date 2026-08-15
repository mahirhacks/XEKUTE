"use strict";

const TESTING_PLAN = [
  "MODE SKILL — Plan",
  "Create or revise a grounded plan from supplied project, workspace, and assessment context.",
  "Use read_file, search_workspace, inspect_environment, manage_plan, manage_state, and attack_graph when exposed.",
  "For each meaningful item record the objective, known facts, unknowns, hypothesis, smallest action, expected signal, stopping condition, and verification criteria.",
  "A plan describes work; it does not claim that the work ran. Keep unrelated files and assessment records unchanged.",
].join("\n");

module.exports = { TESTING_PLAN };
