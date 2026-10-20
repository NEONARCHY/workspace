// Synthetic local UI harness. API requests are intercepted by scripts/grants-smoke.cjs.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { GrantsView } from "../../src/renderer/GrantsView";
import { workspaceTheme, workspaceDarkTheme } from "../../src/renderer/workspace-theme";
import "../../src/renderer/styles.css";
import "../../src/renderer/responsive.css";
import "../../src/renderer/design-system.css";
import "../../src/renderer/record-lists.css";
import "../../src/renderer/spatial-workspace.css";
import "../../src/renderer/section-headers.css";
import "../../src/renderer/dark-theme.css";
import "../../src/renderer/satin-surfaces.css";
import "../../src/renderer/workspace-field-borders.css";
import "../../src/renderer/workspace-modal-backdrops.css";

const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
const people = ["Тестовая Азиза", "Тестовый Бехруз", "Тестовая Зебо", "Тестовый Умид", "Тестовый Бобур"].map((name, i) => ({
  id: `actor-${i}`, name, initials: name.slice(0,1), role: "employee", status: "active" as const, color: "blue",
}));
createRoot(document.getElementById("root")!).render(<FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme} className="app-provider" style={{height:"100dvh",padding:20,boxSizing:"border-box",overflow:"hidden"}}>
  <main style={{height:"100%",minWidth:0}}><GrantsView token="synthetic-grant-test" currentUser={people[0]!} people={people} departments={[]}
    canCreate canAdmin onOpenChat={() => undefined} onPreviewAttachment={() => undefined} onDownloadAttachment={async () => undefined} /></main>
</FluentProvider>);
