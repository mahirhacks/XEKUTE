import React from "react";
import { createRoot } from "react-dom/client";
import "@vscode/codicons/dist/codicon.css";
import "@xterm/xterm/css/xterm.css";
import "highlight.js/styles/github-dark.min.css";
import "../styles/base.css";
import "../styles/chat.css";
import "../styles/settings.css";
import "../styles/layout-revamp.css";
import "./vendor-globals.js";
import App from "./App.jsx";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
