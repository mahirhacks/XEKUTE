import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

globalThis.marked = marked;
globalThis.DOMPurify = DOMPurify;
globalThis.mermaid = mermaid;
globalThis.Terminal = Terminal;
globalThis.FitAddon = FitAddon;

const monacoBase = "./monaco-editor/min";
globalThis.__XEKUTE_MONACO_BASE__ = monacoBase;

// Monaco AMD loader — loaded before editor-controller runs
await new Promise((resolve, reject) => {
  if (globalThis.require?.config) {
    globalThis.require.config({ paths: { vs: `${monacoBase}/vs` } });
    resolve();
    return;
  }
  const script = document.createElement("script");
  script.src = `${monacoBase}/vs/loader.js`;
  script.onload = () => {
    globalThis.require.config({ paths: { vs: `${monacoBase}/vs` } });
    resolve();
  };
  script.onerror = reject;
  document.head.appendChild(script);
});

export const vendorGlobalsReady = true;
