(function installXekuteDom(global) {
  "use strict";

  const getById = (id) => document.getElementById(id);
  const query = (selector, root = document) => root.querySelector(selector);
  const queryAll = (selector, root = document) => [...root.querySelectorAll(selector)];

  global.XekuteDom = Object.freeze({ getById, query, queryAll });
})(globalThis);
