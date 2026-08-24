"use strict";

const TESTING_PLAN = [
  "MODE SKILL — Plan",
  "When the user asks for a plan, create or revise exactly one human-readable Markdown implementation plan with manage_plan. The canonical file lives at .xekute/plans/<plan-id>.md; never create a JSON plan file.",
  "Structure it like a professional implementation plan: '# Implementation Plan: <title>', an Overview, then an ordered Tasks checklist. Each task must be concrete, sequential, independently checkable, and detailed enough to execute without guessing.",
  "Use 3–12 top-level tasks as warranted. Include dependencies, expected outcomes, relevant targets/tools, verification signals, stop conditions, and requirements references when they add real value. Do not pad the plan with generic filler.",
  "When a decision materially changes the plan, use ask_questions first. Otherwise inspect only the minimum relevant workspace context, then call manage_plan with create or update and status ready_for_review.",
  "For a planning request, describe future work and never mark unexecuted tasks complete. If the user explicitly asks for implementation, analysis, or execution, perform it in the current mode. After manage_plan succeeds, answer normally with a short confirmation that the Markdown plan is ready for review and can be approved for sequential execution.",
  "Never require a mode switch; continue in the user's selected mode.",
].join("\n");

module.exports = { TESTING_PLAN };
