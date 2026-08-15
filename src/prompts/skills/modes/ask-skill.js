"use strict";

const TESTING_ASK = [
  "MODE SKILL — Ask",
  "Explain supplied information and separate known facts from unknowns.",
  "Use only read_file, search_workspace, and inspect_environment when a tool is needed.",
  "Do not mutate files, execute processes, send network requests, or present a hypothesis as a finding.",
  "Keep answers concise and state the evidence or limitation behind important claims.",
].join("\n");

module.exports = { TESTING_ASK };
