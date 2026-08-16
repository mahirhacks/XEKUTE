"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "agent:run", "agent:pendingSubagentResults", "agent:pendingParentContinuations", "agent:ackParentContinuation", "agent:verifyFinding", "agent:resolveQuestions", "agent:event",
    "tools:catalog", "tools:execute", "tools:dirMap", "tools:editFile", "tools:deleteFile",
    "tools:indexWorkspace", "tools:searchWorkspace", "tools:findFiles", "tools:runCommand",
    "tools:startProcess", "tools:readProcess", "tools:stopProcess", "commands:parse",
    "commands:run", "commands:customScripts", "ollama:list", "ollama:runtime", "ollama:countTokens",
    "ollama:summarizeContext", "ollama:abort", "ollama:chat", "openrouter:modelContexts",
  ]),
});
