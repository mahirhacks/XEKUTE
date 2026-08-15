/* Profile-specific mode skills — skill-file depth appended at compile time. */

const HypothesisSkill = require("./modes/hypothesis-skill");
const PlanSkill = require("./modes/plan-skill");
const AgentSkill = require("./modes/agent-skill");
const AskSkill = require("./modes/ask-skill");
const { MODE_KEY_ALIASES } = require("../../agent/modes/mode-registry");

const SKILLS = Object.freeze({
  hypothesis: HypothesisSkill.TESTING_HYPOTHESIS,
  plan: PlanSkill.TESTING_PLAN,
  ask: AskSkill.TESTING_ASK,
});

function agentSkillContent() {
  return AgentSkill.TESTING_AGENT;
}

function resolveSkillKey(profileId = "") {
  const raw = String(profileId || "").trim();
  const aliased = MODE_KEY_ALIASES[raw] || raw;
  return MODE_KEY_ALIASES[aliased] || aliased;
}

function render(profileId = "") {
  const key = resolveSkillKey(profileId);
  const content = key === "agent" ? agentSkillContent() : SKILLS[key];
  if (!content) return "";
  return content.trim();
}

function ids() {
  return [...Object.keys(SKILLS), "agent"];
}

module.exports = { SKILLS, render, ids };
