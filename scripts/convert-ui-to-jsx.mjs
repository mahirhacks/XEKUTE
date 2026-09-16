#!/usr/bin/env node
/**
 * Converts src/ui/index.legacy.html #app-shell content into AppShell.jsx.
 * Preserves element IDs so bootstrap.js keeps working.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const legacyPath = path.join(root, "src", "ui", "index.legacy.html");
const fallbackPath = path.join(root, "src", "ui", "index.html");
const htmlPath = fs.existsSync(legacyPath) ? legacyPath : fallbackPath;
const outPath = path.join(root, "src", "ui", "react", "AppShell.jsx");

const html = fs.readFileSync(htmlPath, "utf8");
const start = html.indexOf('<div id="app-shell">');
const end = html.lastIndexOf("</div>", html.indexOf("<script"));
if (start < 0 || end < 0) {
  console.error("Could not extract #app-shell from", htmlPath);
  process.exit(1);
}

let body = html.slice(start, end + 6); // include closing </div>

body = body.replace(/<!--[\s\S]*?-->/g, "");

const ATTR_RENAMES = [
  [/\bclass=/g, "className="],
  [/\bfor=/g, "htmlFor="],
  [/\btabindex=/g, "tabIndex="],
  [/\bspellcheck=/g, "spellCheck="],
  [/\bcontenteditable=/g, "contentEditable="],
  [/\bautocomplete=/g, "autoComplete="],
  [/\breadonly=/g, "readOnly="],
  [/\bmaxlength=/g, "maxLength="],
  [/\bcrossorigin=/g, "crossOrigin="],
];

for (const [from, to] of ATTR_RENAMES) {
  body = body.replace(from, to);
}

body = body
    .replace(/\.\.\/\.\.\/xekute_icon\.png/g, "./xekute_icon.png")
  .replace(/\.\.\/\.\.\/node_modules\//g, "/node_modules/");

// Self-close void elements
const VOID = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
for (const tag of VOID) {
  body = body.replace(new RegExp(`<${tag}([^>]*[^/])>`, "gi"), `<${tag}$1 />`);
}

// Fix boolean attributes for React — use uncontrolled defaults so bootstrap.js can own the DOM.
body = body.replace(/\bhidden=\{true\}/g, "hidden");
body = body.replace(/\bchecked=\{true\}/g, "defaultChecked");
body = body.replace(/\bdisabled=\{true\}/g, "disabled");
body = body.replace(/\bselected=\{true\}/g, "defaultSelected");
body = body.replace(/\breadonly\b/g, "readOnly");
body = body.replace(/(<input[^>]*?)\svalue="/g, "$1 defaultValue=\"");
body = body.replace(/(<textarea[^>]*?)\svalue="/g, "$1 defaultValue=\"");

const output = `/* AUTO-GENERATED — run: node scripts/convert-ui-to-jsx.mjs */
import React from "react";

export default function AppShell() {
  return (
${body.split("\n").map((line) => "    " + line).join("\n")}
  );
}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, output, "utf8");
console.log(`Wrote ${outPath}`);
