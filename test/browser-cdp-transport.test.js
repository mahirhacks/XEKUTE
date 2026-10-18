"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createBrowserCdpTransport } = require("../src/app/services/browser/browser-cdp-transport.js");
const tick = () => new Promise(resolve => setImmediate(resolve));

test("closing before the client connects still delivers close and dispatches no later commands", async () => {
  let invoked = 0, unsubscribed = 0;
  const transport = createBrowserCdpTransport({ records: () => { invoked++; return []; }, current: () => true,
    subscribe: () => () => { unsubscribed++; } });
  transport.close(); transport.close();
  let reason;
  transport.onclose = value => { reason = value; };
  transport.send({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } });
  await tick();
  assert.equal(reason, "Browser control ended."); assert.equal(invoked, 0); assert.equal(unsubscribed, 1);
  assert.equal(await transport.settled(), true);
});

test("the CDP facade discovers only leased targets and rejects browser-wide operations", async () => {
  const debug = new EventEmitter(); let attached = false;
  Object.assign(debug, { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; },
    sendCommand: async () => ({ targetInfo: { targetId: "approved-target" } }) });
  const record = { tab: { id: "approved-tab", title: "Fixture", url: "https://fixture.test/" },
    view: { getBounds: () => ({ x: 5, y: 10, width: 900, height: 600 }), webContents: { isDestroyed: () => false, debugger: debug } } };
  const messages = [];
  const transport = createBrowserCdpTransport({ records: () => [record], current: () => true, subscribe: () => () => {} });
  transport.onmessage = message => messages.push(message);
  transport.send({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } });
  await tick();
  transport.send({ id: 2, method: "Target.getTargets" });
  transport.send({ id: 3, method: "Target.createBrowserContext" });
  transport.send({ id: 4, method: "Browser.getWindowForTarget", params: { targetId: "application-shell" } });
  await tick();
  assert.deepEqual(messages.find(message => message.id === 2).result.targetInfos.map(info => info.targetId), ["approved-target"]);
  assert.match(messages.find(message => message.id === 3).error.message, /Unsupported browser-global/);
  assert.match(messages.find(message => message.id === 4).error.message, /outside this lease/);
  transport.close(); assert.equal(attached, false);
});

test("a button pressed when control ends is recorded for the service to release, and a released one is not", async () => {
  const debug = new EventEmitter(); let attached = false;
  Object.assign(debug, { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; },
    sendCommand: async method => (method === "Target.getTargetInfo" ? { targetInfo: { targetId: "t" } } : {}) });
  const record = { tab: { id: "drag-tab", title: "Fixture", url: "https://fixture.test/" },
    view: { getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), webContents: { isDestroyed: () => false, debugger: debug } } };
  const messages = [];
  const transport = createBrowserCdpTransport({ records: () => [record], current: () => true, subscribe: () => () => {} });
  transport.onmessage = message => messages.push(message);
  transport.send({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } });
  await tick();
  const sessionId = messages.find(message => message.method === "Target.attachedToTarget").params.sessionId;
  assert.equal([...transport.heldPointers()].length, 0);
  const mouse = (id, type, button, x, y) => transport.send({ id, sessionId, method: "Input.dispatchMouseEvent", params: { type, button, x, y } });
  mouse(2, "mousePressed", "left", 12, 34); await tick();
  mouse(3, "mousePressed", "right", 50, 60); await tick();
  mouse(4, "mouseReleased", "right", 50, 60); await tick();
  transport.close();
  assert.deepEqual(transport.heldPointers().get("drag-tab"), [{ button: "left", x: 12, y: 34 }], "only the still-pressed button is recorded for release");
});
