"use strict";

const { MEMORY_IPC_CHANNELS } = require("../../contracts/ipc/memory-ipc-contracts.js");
const { createMemoryIpcService } = require("../services/memory/memory-ipc-service.js");

/*
 * Main-process memory bridge. The Electron wrapper supplied by main.js has
 * already authenticated the renderer and applied the generic IPC size
 * guard; this module applies the memory-specific contracts and delegates to
 * the DI-owned service. No renderer object receives a storage instance.
 */
function registerMemoryIpc({ ipcMain, container, service = null } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("registerMemoryIpc requires ipcMain");
  if (!container && !service) throw new TypeError("registerMemoryIpc requires the DI container or a service");
  const memory = service || container.memoryIpc || createMemoryIpcService({ container });
  const handlers = {
    "memory:status": (_event, payload = {}) => memory.status(payload),
    "memory:diagnostics": (_event, payload = {}) => memory.diagnostics(payload),
    "memory:projectQuery": (_event, payload = {}) => memory.queryProject(payload),
    "memory:investigationQuery": (_event, payload = {}) => memory.queryInvestigation(payload),
    "memory:evidenceQuery": (_event, payload = {}) => memory.queryEvidence(payload),
    "memory:graphQuery": (_event, payload = {}) => memory.graphQuery(payload),
    "memory:artifactList": (_event, payload = {}) => memory.artifactList(payload),
    "memory:artifactExpand": (_event, payload = {}) => memory.artifactExpand(payload),
    "memory:checkpoint": (_event, payload = {}) => memory.checkpoint(payload),
    "memory:checkpointView": (_event, payload = {}) => memory.checkpoint(payload),
    "memory:finalizationHealth": (_event, payload = {}) => memory.finalizationHealth(payload),
    "memory:finalizationStatus": (_event, payload = {}) => memory.finalizationHealth(payload),
    "memory:migrationPreview": (_event, payload = {}) => memory.migrationPreview(payload),
    "memory:operatorMutation": (event, payload = {}) => memory.operatorMutation(payload, event?.sender?.id || "renderer"),
    "memory:securityAudit": (_event, payload = {}) => memory.securityAudit(payload),
    "memory:maintenanceStatus": (_event, payload = {}) => memory.maintenanceStatus(payload),
    "memory:maintenanceBenchmark": (_event, payload = {}) => memory.maintenanceBenchmark(payload),
  };
  for (const channel of MEMORY_IPC_CHANNELS) ipcMain.handle(channel, handlers[channel]);
  return Object.freeze({ channels: [...MEMORY_IPC_CHANNELS], service: memory });
}

module.exports = Object.freeze({ registerMemoryIpc });
