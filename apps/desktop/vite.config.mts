import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const tabsterEsmPath = fileURLToPath(
  new URL("./node_modules/tabster/dist/esm/index.js", import.meta.url),
);

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};
const releaseNotes = JSON.parse(readFileSync(new URL("./release-notes.json", import.meta.url), "utf8")) as {
  version: string;
  title: string;
};
const releaseNoteEntries = readdirSync(new URL("./release-notes/pending/", import.meta.url))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(new URL(`./release-notes/pending/${name}`, import.meta.url), "utf8")) as {
    id: string;
    items: string[];
  });
const releaseNoteItems = releaseNoteEntries.flatMap((entry) => entry.items);
if (releaseNotes.version !== packageJson.version || !releaseNotes.title.trim()
  || releaseNoteItems.length === 0 || releaseNoteItems.length > 50
  || releaseNoteItems.some((item) => item.trim().length < 12 || item.length > 160)) {
  throw new Error("pending release notes must match package version and contain 1–50 concise user-facing changes");
}
const builtAt = new Date().toISOString();
const buildId = process.env.YUKSALISH_WEB_BUILD_ID ?? `${packageJson.version}-${builtAt}`;

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: ".",
  base: mode === "web" ? "/" : "./",
  define: {
    __YUKSALISH_BUILD_ID__: JSON.stringify(buildId),
    __YUKSALISH_APP_VERSION__: JSON.stringify(packageJson.version),
    __YUKSALISH_RELEASE_NOTES__: JSON.stringify({ title: releaseNotes.title, items: releaseNoteItems }),
  },
  resolve: {
    alias: {
      tabster: tabsterEsmPath,
    },
  },
  build: {
    outDir: mode === "web" ? "dist-web" : "dist",
    emptyOutDir: true,
    rollupOptions: mode === "web" ? {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    } : undefined,
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
  // Emit a tiny non-cacheable manifest used by the running web client.
  ...(mode === "web" ? {
    plugins: [react(), {
      name: "yuksalish-version-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify({
            buildId,
            version: packageJson.version,
            builtAt,
            title: releaseNotes.title,
            notes: releaseNoteItems,
            releaseUrl: `https://github.com/NEONARCHY/yuksalish-workspace/releases/tag/v${packageJson.version}`,
          }),
        });
      },
    }],
  } : {}),
}));
