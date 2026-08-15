"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "assessment:create", "assessment:open", "assessment:verify", "assessment:repair",
    "assessment:trafficLog", "assessment:trafficHistory", "assessment:evidence",
    "assessment:appendEvidence", "assessment:appendFinding", "assessment:createRun",
    "assessment:updateRun", "assessment:generateReport", "assessment:runHistory",
    "assessment:deleteTrafficRecords", "assessment:map", "assessment:buildMap", "assessment:deepCollectGraph", "assessment:graphStatus",
    "assessment:mapOverview", "assessment:mapNode", "assessment:mapNeighbors", "assessment:mapPaths",
    "assessment:mapRoutes", "assessment:mapSharedObjects", "assessment:mapEvidence",
    "assessment:mapHypotheses", "assessment:mapAnnotateFinding", "assessment:settings",
    "assessment:intelligenceStatus", "assessment:intelligenceStart", "assessment:intelligencePause",
    "assessment:intelligenceResume", "assessment:intelligenceRebuild", "assessment:intelligenceQuery",
    "assessment:intelligenceExpand", "assessment:intelligence",
    "assessment:writeSettings", "assessment:customEntries", "assessment:createEntry",
    "assessment:deleteEntries", "assessment:buildContext",
  ]),
});
