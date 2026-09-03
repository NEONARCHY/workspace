import { contextBridge } from "electron";

export interface DesktopBridge {
  readonly platform: NodeJS.Platform;
  readonly version: string;
}

const bridge: DesktopBridge = Object.freeze({
  platform: process.platform,
  version: process.env.npm_package_version ?? "0.2.0",
});

contextBridge.exposeInMainWorld("yuksalish", bridge);
