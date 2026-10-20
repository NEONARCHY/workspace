import { beforeEach, expect, it, vi } from "vitest";
import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { registerMailNavigation } from "./mail-navigation";
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { openExternal: vi.fn() } }));
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: "test-client", response_type: "code",
  redirect_uri: "https://workspace.example/api/v1/mail/oauth/callback", state: "s".repeat(40), code_challenge: "c".repeat(43), code_challenge_method: "S256",
  scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" });
function event(trusted = true, focused = true, child = false): IpcMainInvokeEvent {
  const frame = {};
  return { senderFrame: child ? {} : frame, sender: { mainFrame: frame, isFocused: () => focused,
    getURL: () => trusted ? "file:///workspace/index.html" : "https://evil.example" } } as unknown as IpcMainInvokeEvent;
}
beforeEach(() => vi.resetAllMocks());
it("allows only the focused trusted main frame to open Google", async () => {
  registerMailNavigation(value => value === "file:///workspace/index.html");
  const call = vi.mocked(ipcMain.handle).mock.calls[0]!;
  expect(call[0]).toBe("mail:authorize");
  for (const sender of [event(false), event(true,false), event(true,true,true)]) expect(await call[1](sender,url)).toBe(false);
  expect(await call[1](event(),"https://evil.example")).toBe(false); expect(shell.openExternal).not.toHaveBeenCalled();
  expect(await call[1](event(),url)).toBe(true); expect(shell.openExternal).toHaveBeenCalledWith(url);
  vi.mocked(shell.openExternal).mockRejectedValue(new Error("Browser unavailable"));
  expect(await call[1](event(),url)).toBe(false);
});
