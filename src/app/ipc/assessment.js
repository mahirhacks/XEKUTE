"use strict";

module.exports = Object.freeze({
  channels: Object.freeze([
    "assessment:create", "assessment:open", "assessment:verify", "assessment:repair",
    "assessment:trafficLog", "assessment:trafficHistory", "assessment:trafficRecords", "assessment:evidence",
    "assessment:appendEvidence", "assessment:createRun",
    "assessment:updateRun", "assessment:generateReport", "assessment:runHistory",
    "assessment:deleteTrafficRecords", "assessment:settings",
    "assessment:intelligenceStatus", "assessment:intelligenceStart", "assessment:intelligencePause",
    "assessment:intelligenceResume", "assessment:intelligenceRebuild", "assessment:intelligenceQuery",
    "assessment:intelligenceExpand", "assessment:intelligence",
    "assessment:writeSettings", "assessment:customEntries", "assessment:createEntry",
    "assessment:deleteEntries", "assessment:buildContext",
  ]),
});
