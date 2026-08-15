"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "session-memory:load", "session-memory:begin", "session-memory:event", "session-memory:update",
    "session-memory:close", "session-memory:reopen", "session-memory:archive", "session-memory:unarchive",
    "session-memory:flush", "session-memory:save-before-close", "session-memory:delete",
    "context:projectMemory", "context:consolidate", "context:event", "context:flush",
  ]),
});
