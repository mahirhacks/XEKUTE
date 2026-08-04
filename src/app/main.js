"use strict";

// Compatibility launcher: the Electron lifecycle/window shell now lives in
// src/presentation/electron/main.js. This path is retained for older entry
// points and tests; it delegates to the presentation entry.
require("../presentation/electron/main");
