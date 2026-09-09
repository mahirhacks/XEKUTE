"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "settings:certificatesGet", "settings:certificatesChoose", "settings:certificatesReset",
    "settings:certificatesShow", "settings:llmGet", "settings:llmSet", "settings:llmTest",
    "settings:ollamaGet", "settings:ollamaSet", "settings:ollamaTest",
    "settings:identitiesGet", "settings:identityCreate", "settings:identityUpdate",
    "settings:identityDelete", "settings:identityLoginStart", "settings:identityLoginSave",
    "settings:identityLoginCancel", "settings:identityImport", "settings:identityRuntime",
    "settings:identityStatus", "settings:credentialsGet", "settings:credentialCreate", "settings:credentialSave", "settings:credentialDelete",
  ]),
});
