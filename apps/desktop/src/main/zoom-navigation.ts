import { ipcMain, shell } from "electron";
import { validatedZoomLink } from "../shared/zoom-link";

export function registerZoomNavigation(isTrusted: (url: string) => boolean) {
  ipcMain.handle("zoom:join", async (event, candidate: unknown): Promise<boolean> => {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame
      || !event.sender.isFocused() || !isTrusted(event.sender.getURL())) return false;
    const url = validatedZoomLink(candidate);
    if (!url) return false;
    try { await shell.openExternal(url); return true; }
    catch { return false; }
  });
}
