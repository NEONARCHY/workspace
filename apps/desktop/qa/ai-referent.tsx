// Development-only fixture. The smoke runner intercepts every API request.
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { AIReferentView } from "../src/renderer/AIReferentView";
import { WorkspacePeopleProvider } from "../src/renderer/WorkspaceSelect";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/motion.css";
import "../src/renderer/ai-referent.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/ai-referent-workspace.css";
import "../src/renderer/workspace-inputs.css";

const people = [{ id: "reviewer", name: "Ражабов Умид Мажидович", username: "umid", initials: "РУ", role: "manager", color: "teal" }];
createRoot(document.getElementById("root")!).render(
  <FluentProvider className="app-provider" theme={workspaceTheme}>
    <WorkspacePeopleProvider people={people}>
      <AIReferentView token="qa-no-real-token" people={people} canCreate
        focusRequestId={new URLSearchParams(location.search).has("detail") ? "letter-qa" : undefined} />
    </WorkspacePeopleProvider>
  </FluentProvider>,
);
