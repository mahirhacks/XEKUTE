(function installSecurityTemplates(global) {
  "use strict";

  global.XekuteSecurityTemplates = Object.freeze({
    status(label, tone = "neutral") {
      return `<span class="security-status security-status-${tone}">${label}</span>`;
    },
  });
})(globalThis);
