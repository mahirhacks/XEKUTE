"use strict";

/**
 * PromptSourcePort implementation for the Node application runtime.
 *
 * This is the application-layer adapter that reads generated prompt data from
 * the content build through the stable content loader. It is the only
 * application module that touches `content/`; application consumers use the
 * port's methods rather than importing content directly.
 */

const loader = require("../../content/content-loader");

module.exports = {
  getSystemPrompt() {
    return loader.systemPrompt();
  },
  getInitialPrompts() {
    return loader.requireModule("initial_prompt");
  },
  getPolicyPrompts() {
    // Policy/guardrail modules are deterministic application code, not
    // generated prompt content; they live in application/policies.
    return {
      operatingModeRules: require("../policies/operating-mode-rules"),
      runtimePolicyRules: require("../policies/runtime-policy-rules"),
      evidenceRules: require("../policies/evidence-rules"),
      requestIntentRules: require("../policies/request-intent-rules"),
    };
  },
  getSkill(name) {
    return loader.requireModule(String(name));
  },
  getBuildManifest() {
    return loader.loadManifest();
  },
};
