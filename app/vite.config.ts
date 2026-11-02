import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { iife } from "../ui/vite-iife";

export default defineConfig({
  base: "./",
  plugins: [iife(), react()],
  server: {
    port: 1420,
    strictPort: true,
    headers: { "Content-Security-Policy": "frame-src data: blob:" },
  },
});
