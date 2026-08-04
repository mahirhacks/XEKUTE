const test = require("node:test");
const assert = require("node:assert/strict");

const VaptSkillLibrary = require("../src/prompts/skills/vapt-skill-library");

test("VAPT skill library exposes all phase libraries", () => {
  assert.equal(VaptSkillLibrary.ids().length, 9);
  assert.ok(VaptSkillLibrary.LIBRARIES["recon-passive"].content.includes("WSTG-INFO"));
  assert.ok(VaptSkillLibrary.LIBRARIES["normal-vuln-probing"].content.includes("IDOR"));
});

test("hypothesis selection includes header-check for header and CSRF requests", () => {
  const ids = VaptSkillLibrary.selectForHypothesis("check headers and CSRF tokens on the login page");
  assert.ok(ids.includes("header-check"));
  assert.ok(VaptSkillLibrary.LIBRARIES["header-check"].content.includes("CSRF"));
  assert.ok(VaptSkillLibrary.LIBRARIES["header-check"].content.includes("HPP"));
});

test("hypothesis selection includes index and defaults for generic plan requests", () => {
  const ids = VaptSkillLibrary.selectForHypothesis("build a hypothesis plan for the web app");
  assert.ok(ids.includes("preflight"));
  assert.ok(ids.includes("recon-passive"));
  const rendered = VaptSkillLibrary.renderLibraries(ids, { includeIndex: true });
  assert.match(rendered, /VAPT SKILL LIBRARY INDEX/);
  assert.match(rendered, /Passive recon/);
  assert.match(rendered, /Normal vulnerability probing/);
});

test("hypothesis selection scores recon and scanning keywords", () => {
  const ids = VaptSkillLibrary.selectForHypothesis("run nuclei and nmap recon on subdomains");
  assert.ok(ids.includes("recon-active") || ids.includes("automated-security-scan"));
});

test("full pentest plan requests widen library coverage", () => {
  const ids = VaptSkillLibrary.selectForHypothesis("create a comprehensive full pentest plan");
  assert.ok(ids.length >= 5);
  assert.ok(ids.includes("post-vuln-probing"));
});

test("agent selection prioritizes active probing libraries", () => {
  const ids = VaptSkillLibrary.selectForAgent("validate idor on the API", { active: true });
  assert.ok(ids.includes("normal-vuln-probing"));
});
