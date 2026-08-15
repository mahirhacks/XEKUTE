(function installXekuteCore(global) {
  "use strict";

  class LifecycleCollection {
    constructor() { this.cleanups = new Set(); }
    add(cleanup) {
      if (typeof cleanup === "function") this.cleanups.add(cleanup);
      return cleanup;
    }
    listen(target, type, listener, options) {
      target?.addEventListener?.(type, listener, options);
      return this.add(() => target?.removeEventListener?.(type, listener, options));
    }
    timeout(callback, delay) {
      const id = setTimeout(callback, delay);
      return this.add(() => clearTimeout(id));
    }
    dispose() {
      for (const cleanup of [...this.cleanups].reverse()) {
        try { cleanup(); } catch { /* Disposal must be best-effort. */ }
      }
      this.cleanups.clear();
    }
  }

  class XekuteStore {
    constructor(initialState = {}) {
      this.state = Object.freeze({ ...initialState });
      this.listeners = new Set();
    }
    getState() { return this.state; }
    select(selector) { return selector(this.state); }
    update(slice, updater) {
      if (!Object.prototype.hasOwnProperty.call(this.state, slice)) throw new Error(`Unknown store slice: ${slice}`);
      const previous = this.state[slice];
      const next = typeof updater === "function" ? updater(previous) : updater;
      if (Object.is(previous, next)) return previous;
      this.state = Object.freeze({ ...this.state, [slice]: next });
      for (const listener of this.listeners) listener(this.state, slice, previous, next);
      return next;
    }
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  }

  class AppController {
    constructor(store) {
      this.store = store;
      this.workspaceEpoch = 0;
      this.workspaceAbort = null;
    }
    beginWorkspace(identity) {
      this.workspaceAbort?.abort();
      this.workspaceAbort = new AbortController();
      this.workspaceEpoch += 1;
      const epoch = this.workspaceEpoch;
      this.store.update("workspace", (value) => ({ ...value, identity, epoch }));
      return { epoch, signal: this.workspaceAbort.signal };
    }
    isCurrent(epoch) { return epoch === this.workspaceEpoch && !this.workspaceAbort?.signal.aborted; }
    dispose() { this.workspaceAbort?.abort(); }
  }

  function createAppStore() {
    return new XekuteStore({
      workspace: { identity: "", epoch: 0 }, layout: {}, resource: {}, assessment: {},
      security: {}, map: {}, toolbox: {}, settings: {}, chat: {}, terminal: {},
    });
  }

  const core = Object.freeze({ LifecycleCollection, XekuteStore, AppController, createAppStore });
  global.XekuteCore = core;
  global.PointerCore = core;
})(globalThis);
