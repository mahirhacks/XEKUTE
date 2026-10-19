const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const fs = require("node:fs");
const path = require("node:path");

const PACKAGED_ROOT_FILES = new Set(["/package.json", "/LICENSE", "/xekute_icon.png"]);
const PACKAGED_ROOT_DIRS = ["/src", "/node_modules"];

function isIgnoredPackagePath(file) {
  if (!file) return false;
  if (PACKAGED_ROOT_FILES.has(file)) return false;
  if (!PACKAGED_ROOT_DIRS.some((dir) => file === dir || file.startsWith(`${dir}/`))) return true;
  // The renderer ships compiled; its sources and the legacy shell do not.
  if (file.startsWith("/src/ui/")) return !(file === "/src/ui/dist" || file.startsWith("/src/ui/dist/"));
  // .bin shims plus tool caches (Vite's dev prebundle, etc.) are build-time only.
  if (/^\/node_modules\/\.(?:bin|vite|cache)(?:\/|$)/.test(file)) return true;
  return /\.(?:o|obj|pdb|map)$/i.test(file);
}

// node-pty carries native binaries for every OS. Keep only the target's.
function pruneForeignNativeBinaries(buildPath, _electronVersion, platform, arch, done) {
  try {
    const remove = (target) => fs.rmSync(target, { recursive: true, force: true });
    const ptyPrebuilds = path.join(buildPath, "node_modules", "node-pty", "prebuilds");
    if (fs.existsSync(ptyPrebuilds)) {
      for (const name of fs.readdirSync(ptyPrebuilds)) {
        if (name !== `${platform}-${arch}`) remove(path.join(ptyPrebuilds, name));
      }
    }
    done();
  } catch (error) {
    done(error);
  }
}

// scripts/verify-package.js reads these back from the packaged executable.
const PACKAGED_FUSES = {
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
};

module.exports = {
  packagerConfig: {
    name: "XEKUTE",
    executableName: "XEKUTE",
    appBundleId: "com.xekute.securityworkspace",
    icon: "xekute_icon.ico",
    // Electron Forge passes unpack rules through the nested
    // @electron/packager `asar` object.
    asar: {
      unpack: "**/node_modules/node-pty/**/*",
    },
    // Optional offline packaging path for a pre-downloaded Electron ZIP.
    electronZipDir: process.env.XEKUTE_ELECTRON_ZIP_DIR || undefined,
    // Allowlist: only runtime files ship. Anything new at the repository root
    // (notes, tmp scripts, IDE folders, secrets) stays out by default.
    ignore: isIgnoredPackagePath,
    afterPrune: [pruneForeignNativeBinaries],
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
    new FusesPlugin({ version: FuseVersion.V1, ...PACKAGED_FUSES }),
  ],
};

module.exports.isIgnoredPackagePath = isIgnoredPackagePath;
module.exports.PACKAGED_FUSES = PACKAGED_FUSES;
