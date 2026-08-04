"use strict";

/**
 * PromptSourcePort
 *
 * Contract for accessing generated prompt data without exposing Markdown
 * parsing or hashed build filenames to application code. Implemented by the
 * content-build loader and injected by the DI composition root.
 */

const PromptSourcePort = Object.freeze({
  getSystemPrompt() { return undefined; },
  getInitialPrompts() { return undefined; },
  getPolicyPrompts() { return undefined; },
  getSkill(name) { return undefined; },
  getBuildManifest() { return undefined; },
});

module.exports = PromptSourcePort;
