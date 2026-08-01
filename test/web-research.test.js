const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWebResearch,
  extractReadableText,
  isPrivateHostname,
  isPrivateIp,
  parseHttpUrl,
  parseSearchHtml,
} = require("../src/harness/cyber/web-research");

function response({ status = 200, headers = {}, body = "" } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    text: async () => body,
  };
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("web URL guard blocks local, private, metadata, and non-HTTP destinations", () => {
  for (const value of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1", "2001:db8::1"]) {
    assert.equal(isPrivateIp(value), true, value);
  }
  for (const host of ["localhost", "api.local", "metadata.google.internal", "192.168.1.2"]) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.throws(() => parseHttpUrl("file:///etc/passwd"), /HTTP and HTTPS/);
  assert.throws(() => parseHttpUrl("http://localhost:3000"), /private or local/i);
  assert.throws(() => parseHttpUrl("https://user:pass@example.com"), /credentials/i);
  assert.equal(parseHttpUrl("https://example.com/docs").hostname, "example.com");
});

test("search result parsing decodes redirect URLs and readable snippets", () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.com%2Fapi%3Fx%3D1%26y%3D2">Example &amp; API</a>
      <a class="result__snippet">Official <b>API</b> documentation &amp; reference.</a>
    </div>`;
  assert.deepEqual(parseSearchHtml(html, 5), [{
    rank: 1,
    title: "Example & API",
    url: "https://docs.example.com/api?x=1&y=2",
    snippet: "Official API documentation & reference.",
  }]);
});

test("readable page extraction removes active and navigational content and truncates", () => {
  const html = `<html><head><title>Docs &amp; Help</title><style>.x{}</style></head><body>
    <nav>Ignore navigation</nav><main><h1>Install</h1><p>Run the supported command.</p>
    <script>stealSecrets()</script><p>${"details ".repeat(400)}</p></main></body></html>`;
  const result = extractReadableText(html, 1000);
  assert.equal(result.title, "Docs & Help");
  assert.match(result.content, /Install/);
  assert.doesNotMatch(result.content, /navigation|stealSecrets/);
  assert.equal(result.truncated, true);
});

test("web research searches and fetches readable pages with bounded output", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("duckduckgo")) {
      return response({
        headers: { "content-type": "text/html" },
        body: `<a class="result__a" href="https://example.com/docs">Example Docs</a><div class="result__snippet">Primary reference</div>`,
      });
    }
    return response({
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><head><title>Example Docs</title></head><body><article><h1>Reference</h1><p>Supported behavior.</p></article></body></html>",
    });
  };
  const research = createWebResearch({ fetchImpl, lookup: publicLookup });

  const search = await research.searchWeb("example api", { limit: 3 });
  assert.equal(search.ok, true);
  assert.equal(search.results[0].url, "https://example.com/docs");

  const page = await research.fetchWebPage(search.results[0].url, { maxChars: 4000 });
  assert.equal(page.ok, true);
  assert.equal(page.title, "Example Docs");
  assert.match(page.content, /Supported behavior/);
  assert.equal(calls.length, 2);
});

test("redirect destinations are revalidated before a second request", async () => {
  let fetchCount = 0;
  const research = createWebResearch({
    lookup: publicLookup,
    fetchImpl: async () => {
      fetchCount += 1;
      return response({ status: 302, headers: { location: "http://127.0.0.1/admin" } });
    },
  });
  const result = await research.fetchWebPage("https://example.com/start");
  assert.match(result.error, /private or local/i);
  assert.equal(fetchCount, 1);
});

test("DNS rebinding guard rejects a hostname resolving to a private address", async () => {
  let fetchCount = 0;
  const research = createWebResearch({
    lookup: async () => [{ address: "10.0.0.4", family: 4 }],
    fetchImpl: async () => { fetchCount += 1; return response(); },
  });
  const result = await research.fetchWebPage("https://public-looking.example/page");
  assert.match(result.error, /private or reserved/i);
  assert.equal(fetchCount, 0);
});
