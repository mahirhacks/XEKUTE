"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateToolScope, evaluateToolScopeAsync } = require("../src/agent/authority/scope/scope-policy.js");

const projectProfile = { scope: { inScopeTargets: ["*.nasa.gov", "*.globe.gov"] } };
const check = (command, profile = projectProfile) => evaluateToolScope({ toolName: "exec_command", args: { command }, projectProfile: profile });
const loop = [
  "foreach($h in @('api.globe.gov','www.globe.gov','www.oset.nsc.nasa.gov','nsc.nasa.gov')){",
  '  "=== $h ==="',
  '  & curl.exe -sS -k -o NUL -w "  http=%{http_code}`n" --max-time 15 "https://$h/" 2>&1',
  "}",
].join("\n");

test("a curl User-Agent browser version does not become an IP scope target", () => {
  const command = [
    '"=== curl available? ==="; & curl.exe --version 2>&1 | Select-Object -First 1',
    '"=== guest-portal.jpl.nasa.gov ==="',
    '& curl.exe -sS -k -L --max-time 20 -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" -D - -o NUL "https://guest-portal.jpl.nasa.gov/" 2>&1 | Select-Object -First 25',
  ].join("\n");
  assert.equal(check(command).ok, true);
  assert.equal(check(`${command}\ncurl https://122.0.0.0/`).code, "TARGET_OUT_OF_SCOPE");
  assert.equal(check('nmap 122.0.0.0').code, "TARGET_OUT_OF_SCOPE");
});

test("literal PowerShell host loops resolve every concrete URL before scope and DNS checks", async () => {
  const resolved = [];
  const result = await evaluateToolScopeAsync({ toolName: "exec_command", args: { command: loop }, projectProfile,
    resolveAddresses: async target => { resolved.push(String(target)); return { ok: true, addresses: ["93.184.216.34"] }; },
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(resolved, ["https://api.globe.gov/", "https://www.globe.gov/", "https://www.oset.nsc.nasa.gov/", "https://nsc.nasa.gov/"]);
});

test("resolved loop URLs retain port and path restrictions", () => {
  const command = 'foreach ($hostName in @(\'one.example.test\',\'nested.one.example.test\')) { curl "https://${hostName}:8443/api/items" }';
  const profile = { scope: { wildcardRules: ["https://*.example.test:8443/api"] } };
  assert.equal(check(command, profile).ok, true);
  assert.equal(check(command.replace(":8443", ":9443"), profile).code, "TARGET_OUT_OF_SCOPE");
  assert.equal(check(command.replace("/api/items", "/application"), profile).code, "TARGET_OUT_OF_SCOPE");
});

test("an unresolved or reassigned loop hostname gives an actionable parsing error", () => {
  for (const command of [
    'curl "https://$h/"',
    "foreach ($h in @(Get-Content hosts.txt)) { curl \"https://$h/\" }",
    "foreach ($h in @('api.globe.gov')) { $h = $env:OTHER_HOST; curl \"https://$h/\" }",
    "foreach ($h in @('api.globe.gov')) { ${local:h} = $env:OTHER_HOST; curl \"https://$h/\" }",
    "foreach ($h in @('api.globe.gov')) { foreach ($h in $env:HOSTS) { curl \"https://$h/\" } }",
    "foreach ($h in @('api.globe.gov')) { curl 'https://$h/' }",
  ]) {
    const result = check(command);
    assert.equal(result.ok, false);
    assert.equal(result.code, "SCOPE_TARGET_UNRESOLVED");
    assert.match(result.reason, /literal|resolv/i);
  }
});

test("loop destinations still enforce exclusions and unrelated-host denials", async () => {
  for (const [command, profile, deniedHost] of [
    [loop, { scope: { ...projectProfile.scope, outOfScopeTargets: ["api.globe.gov"] } }, "api.globe.gov"],
    [loop.replace("api.globe.gov", "api.globe.gov.evil.test"), projectProfile, "api.globe.gov.evil.test"],
  ]) {
    const resolved = [];
    const result = await evaluateToolScopeAsync({ toolName: "exec_command", args: { command }, projectProfile: profile,
      resolveAddresses: async target => { resolved.push(target); return { ok: true, addresses: ["93.184.216.34"] }; },
    });
    assert.equal(result.code, "TARGET_OUT_OF_SCOPE");
    assert.ok(result.reason.includes(deniedHost), result.reason);
    assert.deepEqual(resolved, []);
  }
});
