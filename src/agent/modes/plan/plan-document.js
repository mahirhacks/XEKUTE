/* Markdown plan document path and prompt contracts. */

const PLAN_DIR = ".xekute/plans";
const PLAN_CREATE_TOOL = "manage_plan";
const PLAN_UPDATE_TOOLS = Object.freeze(["manage_plan"]);
const PLAN_MUTATION_TOOLS = Object.freeze([PLAN_CREATE_TOOL, ...PLAN_UPDATE_TOOLS]);

function slugifyTopic(text = "") {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\b(?:create|build|make|write|save|draft|plan|hypothesis|hypotheses|vapt|pentest|assessment|security|test|for|the|a|an|my|our|please|need|want)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  const slug = words.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 56) || "assessment";
}

function buildPlanDocumentPath(userMessage = "", now = new Date()) {
  const topic = slugifyTopic(userMessage);
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `${PLAN_DIR}/plan-${topic}_${date}_${time}.md`;
}

function planDocumentContract({ path = "", userMessage = "", operation = "create" } = {}) {
  const target = String(path || "").trim();
  if (!target) return "";
  const updating = operation === "update";
  return [
    "PLAN DOCUMENT CONTRACT FOR THIS REQUEST",
    updating
      ? "Update the existing Markdown plan in place with manage_plan (operation update). Read only the context needed for the requested revision."
      : "Create the complete Markdown implementation plan with manage_plan (operation create). Do not write the full plan in chat.",
    "Do not create or update source code, assessment records, or any unrelated workspace file in Plan mode.",
    `When a missing decision materially blocks planning, call ask_questions before ${updating ? "updating" : "creating"} the plan; otherwise make a conservative stated assumption and continue.`,
    `Required path: ${target}`,
    updating
      ? "Preserve useful existing content and apply the operator's requested plan changes at that exact path."
      : "Create a structured plan with an Overview and ordered Markdown checkbox Tasks, matching the professional implementation-plan format.",
    "After manage_plan succeeds, reply in chat with a brief confirmation only: the Markdown path, ready-for-review status, and that approval enables sequential execution. Never paste the full plan body.",
    userMessage ? `Original user request: ${String(userMessage).slice(0, 500)}` : "",
  ].filter(Boolean).join("\n");
}

function planDocumentRetry({ path = "", userMessage = "", operation = "create" } = {}) {
  const updating = operation === "update";
  return [
    `Your previous response did not ${updating ? "update" : "create"} the required plan file.`,
    updating
      ? "Call manage_plan with operation update for the existing plan. Do not answer in chat until the plan is updated."
      : "Call manage_plan with operation create now. Do not answer in chat until the Markdown plan is created.",
    path ? `Required path: ${path}` : "",
    updating
      ? "Do not create a replacement plan at another path and do not modify a non-plan file."
      : "Do not print the plan as chat prose or a fenced code block instead of calling manage_plan.",
    userMessage ? `Original user request: ${userMessage}` : "",
  ].filter(Boolean).join(" ");
}

module.exports = {
  PLAN_DIR,
  PLAN_CREATE_TOOL,
  PLAN_UPDATE_TOOLS,
  PLAN_MUTATION_TOOLS,
  slugifyTopic,
  buildPlanDocumentPath,
  planDocumentContract,
  planDocumentRetry,
};
