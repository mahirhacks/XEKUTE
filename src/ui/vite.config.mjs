import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const nodeModules = path.join(projectRoot, "node_modules");
const uiAssets = path.join(__dirname, "assets");

function serveStaticDir(mount, dir) {
  return (req, res, next) => {
    if (!req.url?.startsWith(mount)) return next();
    const rel = decodeURIComponent(req.url.slice(mount.length));
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return next();
    }
    res.setHeader("Content-Type", mimeFor(file));
    fs.createReadStream(file).pipe(res);
  };
}

function mimeFor(file) {
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "application/javascript";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".woff2")) return "font/woff2";
  if (file.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [
    react(),
    {
      name: "serve-ui-assets",
      configureServer(server) {
        server.middlewares.use(serveStaticDir("/node_modules/", nodeModules));
        server.middlewares.use(serveStaticDir("/assets/", uiAssets));
      },
    },
  ],
  publicDir: path.join(projectRoot, "public-ui"),
  resolve: {
    alias: {
      "@": path.join(__dirname, "react"),
    },
  },
  build: {
    outDir: path.join(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, "index.html"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      allow: [projectRoot],
    },
  },
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },
});
