"use strict";

const { getDefaultMemorySchemaRegistry } = require("./schema-registry.js");
const { MemoryContractError } = require("./memory-errors.js");

const NAMES = Object.freeze([
  "CurrentWorkflowV3", "WorkingReferenceV3", "ConversationCheckpointV3",
  "KagSelectionV3", "KnowledgeProcedurePackageV3",
]);

function validateContract(name, value, registry = getDefaultMemorySchemaRegistry()) { return registry.validate(name, value); }
function assertContract(name, value, registry = getDefaultMemorySchemaRegistry()) { return registry.assertValid(name, value); }

const exportsObject = { NAMES, validateContract, assertContract, MemoryContractError };
for (const name of NAMES) {
  const suffix = name;
  exportsObject[`validate${suffix}`] = (value, registry) => validateContract(name, value, registry);
  exportsObject[`assert${suffix}`] = (value, registry) => assertContract(name, value, registry);
}

module.exports = Object.freeze(exportsObject);
