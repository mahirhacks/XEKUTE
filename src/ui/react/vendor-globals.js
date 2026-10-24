import { marked } from "marked";
import DOMPurify from "dompurify";

globalThis.marked = marked;
globalThis.DOMPurify = DOMPurify;
globalThis.__XEKUTE_MONACO_BASE__ = "./monaco-editor/min";

export const vendorGlobalsReady = true;
