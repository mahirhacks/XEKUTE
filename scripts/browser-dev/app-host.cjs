"use strict";
const { app } = require("electron");
const { assertDevEntry } = require("./runtime.cjs");
assertDevEntry({ isPackaged: app.isPackaged, defaultApp: process.defaultApp, argv: process.argv, userData: process.env.XEKUTE_BROWSER_DEV_USER_DATA });
app.setPath("userData", process.env.XEKUTE_BROWSER_DEV_USER_DATA);
app.disableHardwareAcceleration();
require("../../src/app/electron/main.js");
