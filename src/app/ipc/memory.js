"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "session-memory:load", "session-memory:begin", "session-memory:event", "session-memory:update",
    "session-memory:close", "session-memory:reopen", "session-memory:archive", "session-memory:unarchive",
    "session-memory:flush", "session-memory:save-before-close", "session-memory:delete",
    "context:projectMemory", "context:consolidate", "context:event", "context:flush",
    "context:operationalStatus", "context:operationalRead", "context:operationalCheckpoint",
    "context:operationalMergeLate",
    "memory:status", "memory:projectQuery", "memory:investigationQuery", "memory:evidenceQuery",
    "memory:diagnostics",
    "memory:graphQuery", "memory:artifactList", "memory:artifactExpand", "memory:checkpoint",
    "memory:checkpointView", "memory:finalizationHealth", "memory:finalizationStatus",
    "memory:migrationPreview", "memory:operatorMutation",
    "memory:securityAudit", "memory:maintenanceStatus", "memory:maintenanceBenchmark",
  ]),
});
