(function installSettingsTemplates(global) {
  "use strict";

  global.XekuteSettingsTemplates = Object.freeze({
    sectionHeading(title, subtitle = "") {
      return `<header class="settings-section-heading"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</header>`;
    },
  });
})(globalThis);
