import "@testing-library/jest-dom/vitest";

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver;

// Renderer regression tests historically model the Electron shell. Individual
// web tests temporarily remove this bridge to exercise the browser adapter.
Object.defineProperty(window, "yuksalish", {
  configurable: true,
  writable: true,
  value: {
    platform: "win32",
    version: "0.30.3",
    reportDiagnostic: async () => undefined,
    showNotification: async () => false,
    onNotificationOpen: () => () => undefined,
    loadDraft: async () => null,
    saveDraft: async () => true,
    clearDraft: async () => undefined,
    loadSession: async () => null,
    saveSession: async () => true,
    clearSession: async () => undefined,
  },
});
