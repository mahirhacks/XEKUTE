"use strict";

const features = Object.freeze({
  agent: require("./agent.js"),
  assessment: require("./assessment.js"),
  interceptor: require("./interceptor.js"),
  project: require("./project.js"),
  settings: require("./settings.js"),
  terminal: require("./terminal.js"),
  window: require("./window.js"),
});

function registerIpcHandler(ipcMain, channel, handler) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("ipcMain.handle is required");
  if (!channel || typeof handler !== "function") throw new TypeError("channel and handler are required");
  ipcMain.handle(channel, handler);
  return handler;
}

function featureForChannel(channel) {
  const value = String(channel || "");
  for (const [name, feature] of Object.entries(features)) {
    if (feature.channels.includes(value)) return name;
  }
  return "shared";
}

function registerFeatureHandlers(ipcMain, featureName, handlers = {}) {
  const feature = features[featureName];
  if (!feature) throw new Error(`Unknown IPC feature: ${featureName}`);
  for (const [channel, handler] of Object.entries(handlers)) {
    if (!feature.channels.includes(channel)) throw new Error(`${channel} is not registered in the ${featureName} IPC feature`);
    registerIpcHandler(ipcMain, channel, handler);
  }
}

module.exports = {
  IPC_FEATURES: features,
  featureForChannel,
  registerFeatureHandlers,
  registerIpcHandler,
};
