"use strict";

const { assertGateAdapter } = require("../../contracts/tool/gate-adapter.js");

function createAuthorityRegistry() {
  const modules = new Map();
  const profiles = new Map();
  return Object.freeze({
    registerModule(adapter) {
      assertGateAdapter(adapter);
      if (modules.has(adapter.name)) throw new Error(`DUPLICATE_AUTHORITY_MODULE: ${adapter.name}`);
      modules.set(adapter.name, adapter);
      return adapter;
    },
    registerProfile(profile) {
      if (!profile || typeof profile !== "object" || !String(profile.id || "").trim()) throw new TypeError("Authority profile requires id");
      if (profiles.has(profile.id)) throw new Error(`DUPLICATE_AUTHORITY_PROFILE: ${profile.id}`);
      const pipeline = Array.isArray(profile.modulePipeline) ? profile.modulePipeline : [];
      if (!pipeline.length) throw new Error(`EMPTY_AUTHORITY_PIPELINE: ${profile.id}`);
      if (new Set(pipeline).size !== pipeline.length) throw new Error(`DUPLICATE_AUTHORITY_MODULE_REFERENCE: ${profile.id}`);
      for (const name of pipeline) if (!modules.has(name)) throw new Error(`UNKNOWN_AUTHORITY_MODULE: ${name}`);
      const frozen = Object.freeze({ ...profile, modulePipeline: Object.freeze([...pipeline]), policy: Object.freeze({ ...(profile.policy || {}) }) });
      profiles.set(profile.id, frozen);
      return frozen;
    },
    module(name) { return modules.get(name) || null; },
    profile(name) { return profiles.get(name) || null; },
    modules() { return [...modules.values()]; },
    profiles() { return [...profiles.values()]; },
  });
}

module.exports = { createAuthorityRegistry };
