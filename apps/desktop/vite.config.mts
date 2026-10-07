import react from "@vitejs/plugin-react";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

import { compareReleaseVersions, numberUpdateNotes } from "./src/renderer/release-versions.mts";
import { readReleaseNoteOrder } from "./release-note-order.mts";

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
type ReleaseNoteEntry = { id: string; title?: string; items: string[]; fileName: string };
type ReleaseHistoryEntry = { version: string; date: string; title: string; items: string[] };

// Notes are retained after publication, so numbering from this fixed boundary
// gives the web build and a future EXE the same retrospective update history.
const numberingBaseline = JSON.parse(readFileSync(new URL("./release-notes/numbering-baseline.json", import.meta.url), "utf8")) as {
  lastGroupedVersion: string; fileNames: string[];
};
const lastGroupedVersion = numberingBaseline.lastGroupedVersion;

function noteDate(fileName: string): string {
  return `${fileName.slice(0, 4)}-${fileName.slice(4, 6)}-${fileName.slice(6, 8)}`;
}

function readNoteEntries(directory: URL): ReleaseNoteEntry[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
  .filter((name) => name.endsWith(".json"))
  .sort()
    .map((name) => ({
      ...JSON.parse(readFileSync(new URL(name, directory), "utf8")) as Omit<ReleaseNoteEntry, "fileName">,
      fileName: name,
    }));
}

const releasedRoot = new URL("./release-notes/released/", import.meta.url);
const releasedVersions = existsSync(releasedRoot)
  ? readdirSync(releasedRoot)
    .filter((name) => statSync(new URL(name, releasedRoot)).isDirectory())
    .sort(compareReleaseVersions)
  : [];
const releaseHistory: ReleaseHistoryEntry[] = releasedVersions
    .filter((version) => compareReleaseVersions(version, lastGroupedVersion) <= 0)
    .map((version) => {
      const notes = readNoteEntries(new URL(`${version}/`, releasedRoot));
      return {
        version,
        date: noteDate(notes.at(-1)?.fileName ?? ""),
        title: version === releaseNotes.version ? releaseNotes.title : `Обновление ${version}`,
        items: notes.flatMap((entry) => entry.items),
      };
    }).filter((entry) => entry.items.length > 0);
const pendingEntries = readNoteEntries(new URL("./release-notes/pending/", import.meta.url));
const numberedNotes = [
  ...releasedVersions.filter((version) => compareReleaseVersions(version, lastGroupedVersion) > 0)
    .flatMap((version) => readNoteEntries(new URL(`${version}/`, releasedRoot))),
  ...pendingEntries,
];
const fileOrder = readReleaseNoteOrder(fileURLToPath(new URL("../../", import.meta.url)),
  numberedNotes.map((entry) => entry.fileName), numberingBaseline.fileNames, process.env.YUKSALISH_WEB_BUILD_ID);
const versionedNotes = numberUpdateNotes(numberedNotes, lastGroupedVersion, fileOrder);
const pendingNames = new Set(pendingEntries.map((entry) => entry.fileName));
const pendingItems = [...versionedNotes].reverse().filter((entry) => pendingNames.has(entry.fileName))
  .flatMap((entry) => entry.items);
const updateEntries = versionedNotes.map((entry) => ({
  id: entry.id, date: noteDate(entry.fileName), version: entry.version, items: entry.items,
}));
const currentWebVersion = updateEntries[0]?.version ?? packageJson.version;
const releasedCurrentItems = releaseHistory.find((entry) => entry.version === packageJson.version)?.items ?? [];
// The upload endpoint accepts at most 50 summary lines. The complete history
// stays in the versioned entries even when there are more pending changes.
const summarySource = pendingItems.length > 0 ? pendingItems
  : releasedCurrentItems.length > 0 ? releasedCurrentItems
    : [...versionedNotes].reverse().flatMap((entry) => entry.items);
const releaseNoteItems = summarySource.slice(-50);
const webUpdateItems = updateEntries[0]?.items ?? releaseNoteItems;
if (releaseNotes.version !== packageJson.version || !releaseNotes.title.trim()
  || releaseNoteItems.length === 0
  || releaseNoteItems.some((item) => item.trim().length < 12 || item.length > 160)) {
  throw new Error("release notes must match package version and contain concise user-facing changes");
}
const builtAt = new Date().toISOString();
const buildId = process.env.YUKSALISH_WEB_BUILD_ID ?? `${packageJson.version}-${builtAt}`;
const localTlsDirectory = process.env.YUKSALISH_LOCAL_DEV_TLS_DIR;
const webManifest = {
  buildId,
  version: currentWebVersion,
  builtAt,
  title: releaseNotes.title,
  notes: webUpdateItems,
  history: [
    ...updateEntries.map((entry) => ({ ...entry, title: `Обновление ${entry.version}` })),
    ...releaseHistory,
  ],
};

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: ".",
  base: mode === "web" ? "/" : "./",
  define: {
    __YUKSALISH_BUILD_ID__: JSON.stringify(buildId),
    __YUKSALISH_APP_VERSION__: JSON.stringify(mode === "web" ? currentWebVersion : packageJson.version),
    __YUKSALISH_RELEASE_NOTES__: JSON.stringify({ title: releaseNotes.title, items: releaseNoteItems }),
    __YUKSALISH_UPDATE_ENTRIES__: JSON.stringify(updateEntries),
    __YUKSALISH_RELEASE_HISTORY__: JSON.stringify(releaseHistory),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
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
    https: localTlsDirectory ? {
      key: readFileSync(resolve(localTlsDirectory, "localhost.key")),
      cert: readFileSync(resolve(localTlsDirectory, "localhost.crt")),
    } : undefined,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_PROXY_TARGET ?? "http://127.0.0.1:8080",
        // Secure web sessions validate Origin against Host, including the local HTTPS port.
        changeOrigin: !localTlsDirectory,
        ws: true,
      },
    },
  },
  ssr: {
    noExternal: [/@fluentui/, /tabster/, /keyborg/],
  },
  test: {
    environment: "jsdom",
    maxWorkers: 4,
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
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const path = request.url?.split("?")[0];
          if (path === "/version.json") {
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify(webManifest));
          } else if (path === "/__local-dev.json" && localTlsDirectory) {
            response.setHeader("Content-Type", "application/json");
            response.setHeader("Cache-Control", "no-store");
            response.end(JSON.stringify({
              deploymentId: process.env.YUKSALISH_LOCAL_DEV_DEPLOYMENT_ID,
              runnerPid: Number(process.env.YUKSALISH_LOCAL_DEV_RUNNER_PID),
              devServerPid: process.pid,
              workspaceRoot: fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]+$/, ""),
            }));
          } else next();
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: JSON.stringify(webManifest),
        });
      },
    }],
  } : {}),
}));
