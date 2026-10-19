import type { ReactNode } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { useColorTheme } from "./color-theme";
import { workspaceDarkTheme, workspaceTheme } from "./workspace-theme";

export function WorkspaceFluentProvider({ userId, children }: {
  readonly userId?: string;
  readonly children: ReactNode;
}) {
  const { theme } = useColorTheme(userId);
  return <FluentProvider theme={theme === "dark" ? workspaceDarkTheme : workspaceTheme} className="app-provider">
    {children}
  </FluentProvider>;
}
