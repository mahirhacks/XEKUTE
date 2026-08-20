"use strict";

const TESTING_PLAN = [
  "MODE SKILL — Plan",
  "Create or revise exactly one human-readable Markdown implementation plan with manage_plan. The canonical file lives at .xekute/plans/<plan-id>.md; never create a JSON plan file.",
  "Structure it like a professional implementation plan: '# Implementation Plan: <title>', an Overview, then an ordered Tasks checklist. Each task must be concrete, sequential, independently checkable, and detailed enough to execute without guessing.",
  "Use 3–12 top-level tasks as warranted. Include dependencies, expected outcomes, relevant targets/tools, verification signals, stop conditions, and requirements references when they add real value. Do not pad the plan with generic filler.",
  "When a decision materially changes the plan, use ask_questions first. Otherwise inspect only the minimum relevant workspace context, then call manage_plan with create or update and status ready_for_review.",
  "A plan describes future work; do not implement it in Plan mode and never mark unexecuted tasks complete. After manage_plan succeeds, answer normally with a short confirmation that the Markdown plan is ready for review and can be approved for sequential execution.",
].join("\n");

module.exports = { TESTING_PLAN };
