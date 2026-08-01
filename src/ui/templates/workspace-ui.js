(function installWorkspaceTemplates(global) {
  "use strict";

  global.XekuteWorkspaceTemplates = Object.freeze({
    emptyState({ title = "No workspace open", detail = "Open a project to get started." } = {}) {
      return `<section class="workspace-empty-state"><strong>${title}</strong><span>${detail}</span></section>`;
    },
  });
})(globalThis);
