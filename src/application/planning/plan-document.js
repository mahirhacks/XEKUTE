/* Hypothesis plan document path and prompt contracts. */

const PLAN_DIR = "plans";
const PLAN_CREATE_TOOL = "create_file";
const PLAN_UPDATE_TOOLS = Object.freeze(["patch_file", "write_file"]);
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
      ? "Update the existing hypothesis plan in place. Call read_file first when its exact contents are not already supplied, then use patch_file for focused revisions or write_file only for an intentional full-plan rewrite."
      : "Create the complete hypothesis plan with create_file. Do not write the full hypothesis plan in chat.",
    "Do not create or update source code, assessment records, or any unrelated workspace file in Hypothesis mode.",
    `When a missing decision materially blocks planning, call request_operator_questions before ${updating ? "updating the plan" : "create_file"}. Ask 1–3 short plain-language questions with 2–3 choices each; otherwise make a conservative stated assumption and continue.`,
    `Required path: ${target}`,
    updating
      ? "Preserve useful existing content and apply the operator's requested plan changes at that exact path."
      : "Put the full VAPT hypothesis plan in the file content: engagement snapshot, scope, attack surface, numbered hypotheses (9-field loop), WSTG/Top 10 matrix, evidence capture, stop conditions, and limitations.",
    "After the plan-file mutation succeeds, reply in chat with a brief summary only (path, hypothesis count, top priorities, blocked items) — never paste the full plan body.",
    userMessage ? `Original user request: ${String(userMessage).slice(0, 500)}` : "",
  ].filter(Boolean).join("\n");
}

function planDocumentRetry({ path = "", userMessage = "", operation = "create" } = {}) {
  const updating = operation === "update";
  return [
    `Your previous response did not ${updating ? "update" : "create"} the required plan file.`,
    updating
      ? "Call read_file if needed, then patch_file or write_file for the existing plan. Do not answer in chat until the plan is updated."
      : "Call create_file now with the complete plan markdown. Do not answer in chat until the file is created.",
    path ? `Required path: ${path}` : "",
    updating
      ? "Do not create a replacement plan at another path and do not modify a non-plan file."
      : "Do not use patch_file for a new plan. Do not print the plan as chat prose or a fenced code block instead of create_file.",
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
