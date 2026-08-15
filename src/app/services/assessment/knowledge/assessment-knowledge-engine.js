"use strict";

const path = require("node:path");
const { createSkillKnowledgeGraph } = require("./skill-knowledge-graph.js");

function createAssessmentKnowledgeEngine({ libraryRoot = path.resolve(__dirname, "../../../../prompts/skills"), mcpRuntime = null } = {}) {
  const root = path.basename(libraryRoot).toLowerCase() === "libraries" ? path.dirname(libraryRoot) : libraryRoot;
  const graph = createSkillKnowledgeGraph({ libraryRoot: root, mcpRuntime });
  return Object.freeze({
    query: (input = {}, context = {}) => graph.query(input, context),
    list: () => graph.list(),
    validation: () => graph.validation(),
    load: () => graph.load(),
    invalidate: () => graph.invalidate(),
    graph,
  });
}

module.exports = { createAssessmentKnowledgeEngine };
