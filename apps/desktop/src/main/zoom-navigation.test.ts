import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { registerZoomNavigation } from "./zoom-navigation";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }));
function event({ trusted = true, focused = true, child = false } = {}): IpcMainInvokeEvent {
  const frame = {};
  return { senderFrame: child ? {} : frame, sender: {
    mainFrame: frame, isFocused: () => focused, getURL: () => trusted ? "file:///workspace/index.html" : "https://untrusted.test",
  } } as unknown as IpcMainInvokeEvent;
}
beforeEach(() => vi.resetAllMocks());
describe("Zoom external navigation capability", () => {
  it("opens only an explicitly allowed meeting from the focused trusted main frame", async () => {
    registerZoomNavigation(url => url === "file:///workspace/index.html");
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]![1];
    expect(vi.mocked(ipcMain.handle).mock.calls[0]![0]).toBe("zoom:join");
    expect(await handler(event(), "https://zoom.us/j/123456789")).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith("https://zoom.us/j/123456789");
  });
  it.each([{ trusted: false }, { focused: false }, { child: true }])("rejects an untrusted sender: %s", async options => {
    registerZoomNavigation(url => url === "file:///workspace/index.html");
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]![1];
    expect(await handler(event(options), "https://zoom.us/j/123456789")).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });
  it("rejects arbitrary navigation and reports operating-system errors", async () => {
    registerZoomNavigation(() => true);
    const handler = vi.mocked(ipcMain.handle).mock.calls[0]![1];
    expect(await handler(event(), "https://other.test")).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
    vi.mocked(shell.openExternal).mockRejectedValue(new Error("Browser unavailable"));
    expect(await handler(event(), "https://zoom.us/j/123456789")).toBe(false);
  });
});
