"use strict";

module.exports = {
  appId: "com.xekute.securityworkspace",
  productName: "XEKUTE",
  directories: {
    output: "out/make/nsis",
    buildResources: ".",
  },
  win: {
    executableName: "XEKUTE",
    icon: "xekute_icon.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
    signAndEditExecutable: false,
  },
  publish: {
    provider: "github",
    owner: "mahirhacks",
    repo: "XEKUTE",
    releaseType: "release",
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: false,
    createStartMenuShortcut: false,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    artifactName: "XEKUTESetup.exe",
    uninstallDisplayName: "XEKUTE",
    include: "build/installer.nsh",
  },
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
};
