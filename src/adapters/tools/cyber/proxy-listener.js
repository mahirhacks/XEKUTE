"use strict";

const { Proxy } = require("http-mitm-proxy");

/**
 * Concrete proxy adapter around http-mitm-proxy. The domain proxy module owns
 * pure capture/filter/forward/drop decisions; this adapter supplies the
 * concrete proxy lifecycle so domain code never imports a third-party library.
 */
function createMitmProxyAdapter() {
  let instance = null;

  function create() {
    instance = new Proxy();
    return instance;
  }

  function listen(options) {
    return new Promise((resolve) => {
      instance.listen(options, (error) => {
        resolve({ error: error ? error.message || String(error) : "", instance });
      });
    });
  }

  function close() {
    if (!instance) return;
    try { instance.close(); } catch { /* ignore */ }
    instance = null;
  }

  return { create, listen, close };
}

module.exports = { createMitmProxyAdapter };
