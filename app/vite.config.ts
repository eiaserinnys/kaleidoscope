import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    headers: { "Content-Security-Policy": "frame-src data: blob:" },
  },
});
