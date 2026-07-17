const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

module.exports = {
  packagerConfig: {
    name: "XEKUTE",
    executableName: "XEKUTE",
    appBundleId: "com.xekute.securityworkspace",
    asar: true,
    asarUnpack: ["**/node_modules/node-pty/**", "**/src/commands/**", "**/src/context/**"],
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
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "XEKUTE",
        setupExe: "XEKUTESetup.exe",
        setupIcon: undefined,
        certificateFile: process.env.WINDOWS_CERTIFICATE_FILE || undefined,
        certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD || undefined,
      },
    },
  ],
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
