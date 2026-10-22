// Synthetic QA only: scripts/dossiers-smoke.cjs intercepts every API request.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { HrView } from "../../src/renderer/HrView";
import { workspaceTheme, workspaceDarkTheme } from "../../src/renderer/workspace-theme";
import "../../src/renderer/styles.css";
import "../../src/renderer/responsive.css";
import "../../src/renderer/design-system.css";
import "../../src/renderer/record-lists.css";
import "../../src/renderer/spatial-workspace.css";
import "../../src/renderer/section-headers.css";
import "../../src/renderer/dark-theme.css";
import "../../src/renderer/satin-surfaces.css";
import "../../src/renderer/workspace-inputs.css";
import "../../src/renderer/workspace-search.css";
import "../../src/renderer/workspace-field-borders.css";
import "../../src/renderer/workspace-modal-backdrops.css";
import "../../src/renderer/hr.css";

const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
const people = ["Тестовый Администратор", "Тестовый Сотрудник Полное ФИО"].map((name, i) => ({
  id: `qa-${i}`, name, initials: "ТС", role: i ? "employee" : "admin", status: "active" as const, color: "blue",
}));
createRoot(document.getElementById("root")!).render(<FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme} className="app-provider" style={{height:"100dvh",padding:20,boxSizing:"border-box",overflow:"hidden"}}>
  <main style={{height:"100%",minWidth:0}}><HrView token="synthetic-dossier-test" currentUser={people[0]!} people={people} departments={[]} /></main>
</FluentProvider>);
