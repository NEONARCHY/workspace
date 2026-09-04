import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const tabsterEsmPath = fileURLToPath(
  new URL("./node_modules/tabster/dist/esm/index.js", import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  root: ".",
  base: "./",
  resolve: {
    alias: {
      tabster: tabsterEsmPath,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  ssr: {
    noExternal: [/@fluentui/, /tabster/, /keyborg/],
  },
  test: {
    environment: "jsdom",
    // Multi-step Fluent UI scenarios can exceed 5s on Windows while packaging runs.
    testTimeout: 10000,
    setupFiles: "./src/renderer/test-setup.ts",
    server: {
      deps: {
        inline: [/@fluentui/, /tabster/, /keyborg/],
      },
    },
  },
});
