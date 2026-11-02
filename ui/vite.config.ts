import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(packageDir, "harness"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@kaleidoscope\/ui\/styles\.css$/, replacement: resolve(packageDir, "src/styles/index.css") },
      { find: /^@kaleidoscope\/ui$/, replacement: resolve(packageDir, "src/index.ts") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    headers: { "Content-Security-Policy": "frame-src data: blob:" },
    fs: { allow: [resolve(packageDir, ".."), packageDir] },
  },
});
