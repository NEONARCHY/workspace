// Synthetic fixture: all API traffic is intercepted by the smoke runner.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { TeamDashboardView } from "../src/renderer/TeamDashboardView";
import { workspaceDarkTheme, workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/ai-referent.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/workspace-field-borders.css";
import "../src/renderer/workspace-inputs.css";
const dark = new URLSearchParams(location.search).has("dark");
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
function Fixture() {
  const [selected, setSelected] = useState("");
  return <FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme}>
    <main className="signature-qa">
      <TeamDashboardView token="synthetic-token" currentUserId="qa-reviewer" tasks={[]} people={[]}
        efficiencyLoading={false} onSelectTask={() => undefined} onSelectPaymentRequest={() => undefined}
        onSelectSignatureLetter={setSelected} />
      <output aria-label="Выбранное письмо">{selected}</output>
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
