"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createAssessmentModeWorkflow } = require("../src/app/services/assessment/mode-workflow.js");

function parseArgs(argv) {
  const values = new Set(argv.slice(2));
  return { workspace: argv.find((value, index) => index > 1 && !value.startsWith("--")) || process.cwd(), dryRun: values.has("--dry-run") };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter(Boolean);
  } catch { return []; }
}

function migrate(workspace, { dryRun = false } = {}) {
  const root = path.resolve(String(workspace || ""));
  const workflow = createAssessmentModeWorkflow();
  const report = { ok: true, workspace: root, dryRun, importedPlans: 0, importedHypotheses: 0, skipped: 0, errors: [] };
  const previousMigration = workflow.loadState(root).migration?.assessmentWorkflow || {};
  const planIds = { ...(previousMigration.planIds || {}) };
  const hypothesisIds = { ...(previousMigration.hypothesisIds || {}) };
  const legacyPlanRoot = path.join(root, ".xekute", "plans");
  if (fs.existsSync(legacyPlanRoot)) {
    for (const entry of fs.readdirSync(legacyPlanRoot)) {
      if (!entry.endsWith(".json")) continue;
      const record = readJson(path.join(legacyPlanRoot, entry));
      if (!record) { report.errors.push(`Could not parse ${entry}`); continue; }
      const id = planIds[entry] || (/^plan_\d+$/.test(String(record.id || "")) ? record.id : `plan_${workflow.loadState(root).nextPlan}`);
      if (fs.existsSync(workflow.artifactPath(root, "plan", id))) { report.skipped += 1; continue; }
      if (!dryRun) workflow.savePlan(root, { ...record, id, objective: record.objective || record.title || id, tasks: record.tasks || [], status: record.status || "draft" });
      planIds[entry] = id;
      report.importedPlans += 1;
    }
  }
  const legacyHypothesisLog = path.join(root, ".xekute", "logs", "agent-hypotheses.jsonl");
  for (const [index, record] of readJsonl(legacyHypothesisLog).entries()) {
    const key = `${index}:${record.id || record.title || record.question || "hypothesis"}`;
    const nextId = hypothesisIds[key] || `hypothesis_${workflow.loadState(root).nextHypothesis}`;
    if (fs.existsSync(workflow.artifactPath(root, "hypothesis", nextId))) { report.skipped += 1; continue; }
    if (!dryRun) workflow.saveHypothesis(root, { id: nextId, statement: record.statement || record.title || record.question || "Imported hypothesis", confidence: record.confidence || "inconclusive", observationIds: record.observationIds || [], entityIds: record.entityIds || [], evidenceRefs: record.evidenceRefs || record.evidenceIds || [], evidenceGaps: record.evidenceGaps || [], status: record.status || "imported" });
    hypothesisIds[key] = nextId;
    report.importedHypotheses += 1;
  }
  if (!dryRun) workflow.saveState(root, { migration: { assessmentWorkflow: { ...previousMigration, completedAt: new Date().toISOString(), importedPlans: report.importedPlans, importedHypotheses: report.importedHypotheses, planIds, hypothesisIds } } });
  return report;
}

if (require.main === module) {
  const { workspace, dryRun } = parseArgs(process.argv);
  process.stdout.write(`${JSON.stringify(migrate(workspace, { dryRun }), null, 2)}\n`);
}

module.exports = { migrate, parseArgs };
