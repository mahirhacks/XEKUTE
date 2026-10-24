const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const katex = require("katex");

test("the patched math renderer retains ordinary formula output", t => {
  const dom = new JSDOM(katex.renderToString("x^2", { trust: false }));
  t.after(() => dom.window.close());
  assert.ok(dom.window.document.querySelector(".katex math msup"));
  assert.equal(dom.window.document.querySelector("msup mi").textContent, "x");
  assert.equal(dom.window.document.querySelector("msup mn").textContent, "2");
});

test("inherited math-renderer trust cannot enable attacker-controlled links", t => {
  const options = Object.assign(Object.create({ trust: true }), { throwOnError: false });
  const dom = new JSDOM(katex.renderToString("\\href{https://attacker.invalid/}{click}", options));
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector("a[href], img[src], iframe[src]"), null);
});
