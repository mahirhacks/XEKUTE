(function installChatTemplates(global) {
  "use strict";

  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

  global.XekuteChatTemplates = Object.freeze({
    taskBrief({ title = "Working", detail = "Preparing the next step" } = {}) {
      return `<section class="agent-task-brief"><strong>${escape(title)}</strong><span>${escape(detail)}</span></section>`;
    },
    activity({ label = "Working", state = "active" } = {}) {
      return `<div class="agent-activity-row" data-state="${escape(state)}"><span class="agent-activity-label">${escape(label)}</span></div>`;
    },
  });
})(globalThis);
