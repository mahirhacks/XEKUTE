"use strict";

const path = require("node:path");

function createPlanPort({ fs, path: pathModule = path } = {}) {
  function file(context) { return pathModule.join(context.workspace, ".xekute", "plans", "unified-plan.json"); }
  function load(context) {
    try { return JSON.parse(fs.readFileSync(file(context), "utf8")); } catch { return { version: 1, plans: [] }; }
  }
  function save(context, document) {
    const target = file(context);
    fs.mkdirSync(pathModule.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return document;
  }
  async function execute(input, context) {
    const document = load(context);
    if (input.action === "get") return { ok: true, plans: document.plans.slice(0, 50) };
    if (input.action === "create") {
      const plan = { id: input.plan_id || `plan-${Date.now().toString(36)}`, title: input.title || "Untitled plan", content: input.content || "", status: "open", steps: [] };
      document.plans = [...document.plans.filter((item) => item.id !== plan.id), plan];
      save(context, document);
      return { ok: true, plan_id: plan.id, status: plan.status };
    }
    const plan = document.plans.find((item) => item.id === input.plan_id) || document.plans[0];
    if (!plan) return { ok: false, error: "Plan not found.", code: "PLAN_NOT_FOUND" };
    if (["update_step", "complete_step"].includes(input.action)) {
      const step = plan.steps.find((item) => item.id === input.step_id) || { id: input.step_id || `step-${plan.steps.length + 1}`, title: input.title || "Step", status: "open" };
      if (!plan.steps.includes(step)) plan.steps.push(step);
      if (input.action === "complete_step") step.status = "completed";
      if (input.title) step.title = input.title;
      save(context, document);
      return { ok: true, plan_id: plan.id, step_id: step.id, status: step.status };
    }
    if (input.action === "close") { plan.status = "closed"; save(context, document); return { ok: true, plan_id: plan.id, status: plan.status }; }
    return { ok: true, plan };
  }
  return Object.freeze({ execute });
}

module.exports = { createPlanPort };
