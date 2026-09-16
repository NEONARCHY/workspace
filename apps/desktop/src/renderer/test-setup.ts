import "@testing-library/jest-dom/vitest";
import { disposeTabster, getTabster } from "tabster";
import { afterAll } from "vitest";

class TestResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver;
const testNodeFilter = {
  FILTER_ACCEPT: 1,
  FILTER_REJECT: 2,
  FILTER_SKIP: 3,
  SHOW_ALL: 0xffffffff,
  SHOW_ELEMENT: 0x1,
} as typeof NodeFilter;
Object.defineProperty(globalThis, "NodeFilter", {
  configurable: true,
  value: testNodeFilter,
});
Object.defineProperty(window, "NodeFilter", {
  configurable: true,
  value: testNodeFilter,
});

afterAll(() => {
  const tabster = getTabster(window);
  if (tabster) disposeTabster(tabster, true);
});

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
