"use strict";

// In-memory fake browser provider for the main app. Supports the full
// browser_action surface (navigate/click/type/select/wait/extract) against a
// synthetic DOM so the actions work offline when Playwright is unavailable.
// Mirrors the temp_test harness fake so main and harness behave the same.

function createFakeBrowserProvider() {
  const state = {
    url: "about:blank",
    title: "",
    bodyText: "",
    html: "",
    attributes: {},
    values: {},
  };

  return {
    state,
    async execute(input) {
      const action = input.action;
      switch (action) {
        case "navigate": {
          state.url = input.url;
          state.title = `Page at ${input.url}`;
          state.bodyText = `Fixture content for ${input.url}`;
          state.html = `<html><head><title>${state.title}</title></head><body>${state.bodyText}</body></html>`;
          return { ok: true, url: state.url, title: state.title, bodyText: state.bodyText };
        }
        case "click": {
          if (!state.html) return { ok: false, error: "no page loaded" };
          return { ok: true, clicked: input.selector, url: state.url };
        }
        case "type": {
          state.values[input.selector] = input.text;
          return { ok: true, typed: input.text, into: input.selector };
        }
        case "select": {
          state.values[input.selector] = input.option;
          return { ok: true, selected: input.option, in: input.selector };
        }
        case "wait": {
          return { ok: true, waitedMs: input.waitMs || 0 };
        }
        case "extract": {
          const extract = input.extract || { type: "text" };
          const selector = input.selector || "body";
          if (extract.type === "title") return { ok: true, title: state.title };
          if (extract.type === "url") return { ok: true, url: state.url };
          if (extract.type === "html") return { ok: true, html: state.html };
          if (extract.type === "attribute") return { ok: true, attribute: { [extract.attribute || "href"]: `https://fixture.test/${selector}` } };
          if (extract.type === "all") return { ok: true, url: state.url, title: state.title, bodyText: state.bodyText, html: state.html };
          return { ok: true, text: state.bodyText, url: state.url };
        }
        default:
          return { ok: false, error: `unsupported action: ${action}` };
      }
    },
  };
}

module.exports = {
  createFakeBrowserProvider,
};
