"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readUiShell() {
  const jsx = fs.readFileSync(path.join(__dirname, "..", "..", "src", "ui", "react", "AppShell.jsx"), "utf8");
  return jsx.replaceAll("className=", "class=").replaceAll("contentEditable=", "contenteditable=");
}

module.exports = { readUiShell };
