// QA-only theme wiring: production hook/theme, no alternative visual layer.
import { useColorTheme } from "../src/renderer/color-theme";
import { workspaceDarkTheme, workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/dark-theme.css";

export function useQaTheme() {
  const { theme } = useColorTheme(undefined);
  return theme === "dark" ? workspaceDarkTheme : workspaceTheme;
}
if (new URLSearchParams(location.search).has("theme")) {
  const dark = new URLSearchParams(location.search).get("theme") === "dark";
  localStorage.setItem("yuksalish:color-theme:last", dark ? "dark" : "light");
  localStorage.setItem("yuksalish:color-theme:qa-theme", dark ? "dark" : "light");
}
