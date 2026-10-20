import { ipcMain, shell } from "electron";
import { validatedGoogleMailLink } from "../shared/google-mail-link";

export function registerMailNavigation(isTrusted: (url: string) => boolean, allowLocalhost = false) {
  ipcMain.handle("mail:authorize", async (event, candidate: unknown): Promise<boolean> => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame
      || !event.sender.isFocused() || !isTrusted(event.sender.getURL())) return false;
    const url = validatedGoogleMailLink(candidate, allowLocalhost);
    if (!url) return false;
    try { await shell.openExternal(url); return true; }
    catch { return false; }
  });
}
