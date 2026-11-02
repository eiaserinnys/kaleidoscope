import { defineConfig } from "vitest/config";
import { iife } from "./vite-iife";

export default defineConfig({
  plugins: [iife()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 60_000,
    maxWorkers: 2,
  },
});
