(function installXekuteDom(global) {
  "use strict";

  const getById = (id) => document.getElementById(id);

  global.XekuteDom = Object.freeze({ getById });
})(globalThis);
