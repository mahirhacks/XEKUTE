(function installXekuteUiState(global) {
  "use strict";

  function createUiState(initial = {}) {
    let value = { ...initial };
    const listeners = new Set();
    return {
      get: () => value,
      update(patch = {}) {
        value = { ...value, ...patch };
        listeners.forEach((listener) => listener(value));
        return value;
      },
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  global.XekuteUiState = Object.freeze({ createUiState });
})(globalThis);
