/* Profile-specific mode skills — skill-file depth appended at compile time. */

const HypothesisSkill = require("./modes/hypothesis-skill");
const PlanSkill = require("./modes/plan-skill");
const AgentSkill = require("./modes/agent-skill");
const AskSkill = require("./modes/ask-skill");
const { MODE_KEY_ALIASES } = require("../rules/operating-mode-rules");

const SKILLS = Object.freeze({
  hypothesis: HypothesisSkill.TESTING_HYPOTHESIS,
  planner: PlanSkill.TESTING_PLAN,
  agent: AgentSkill.TESTING_AGENT,
  ask: AskSkill.TESTING_ASK,
});

function resolveSkillKey(profileId = "") {
  const raw = String(profileId || "").trim();
  const aliased = MODE_KEY_ALIASES[raw] || raw;
  return MODE_KEY_ALIASES[aliased] || aliased;
}

function render(profileId = "") {
  const key = resolveSkillKey(profileId);
  const content = SKILLS[key];
  if (!content) return "";
  return content.trim();
}

function ids() {
  return Object.keys(SKILLS);
}

module.exports = { SKILLS, render, ids };
