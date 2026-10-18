"use strict";

const { PROFILES } = require("./profile-manifest.js");
const { moduleOrder } = require("../gates/pipeline-manifest.js");

function registerProductionProfiles(registry) {
  for (const profile of Object.values(PROFILES)) {
    registry.registerProfile({
      ...profile,
      modulePipeline: [...moduleOrder],
    });
  }
  return registry;
}

module.exports = { registerProductionProfiles };
