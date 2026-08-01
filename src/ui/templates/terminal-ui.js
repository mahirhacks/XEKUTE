(function installTerminalTemplates(global) {
  "use strict";

  global.XekuteTerminalTemplates = Object.freeze({
    sessionTab({ id = "", label = "Terminal", active = false } = {}) {
      return `<button type="button" class="terminal-session-tab${active ? " active" : ""}" data-terminal-session="${String(id).replace(/"/g, "&quot;")}">${String(label).replace(/</g, "&lt;")}</button>`;
    },
  });
})(globalThis);
