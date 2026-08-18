const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    name: "XEKUTE",
    executableName: "XEKUTE",
    appBundleId: "com.xekute.securityworkspace",
    icon: "xekute_icon.ico",
    asar: true,
    asarUnpack: ["**/node_modules/node-pty/**"],
    ignore: [
      /^\/(?:\.git|\.github|\.cursor|\.agents|\.commandcode|architecture|docs|graphify-out|out|scripts|temp_test|test|tmp|version_tracking)(?:\/|$)/,
/^\/?(?:\.env(?:\..*)?|\.gitignore|\.graphifyignore|AGENTS\.md|forge\.config\.js|INSTALL\.md|README\.md|update-publish\.md|unified-tool-process-monitoring\.md)$/,
    ],
    win32metadata: {
      CompanyName: "XEKUTE",
      FileDescription: "XEKUTE Security Workspace",
      ProductName: "XEKUTE",
      InternalName: "XEKUTE",
      OriginalFilename: "XEKUTE.exe",
    },
  },
  rebuildConfig: {
    // node-pty 1.1 ships N-API prebuilds for Windows x64. Rebuilding them
    // unnecessarily requires optional Spectre MSVC libraries and provides no
    // ABI benefit, so package the verified prebuild instead.
    onlyModules: ["__xekute_uses_node_pty_prebuild__"],
  },
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    }),
  ],
};
