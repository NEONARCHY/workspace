// Development-only fixture. The smoke runner intercepts every API request.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { EmployeesView } from "../src/renderer/EmployeesView";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/responsive.css";

function Fixture() {
  const [, setWorkspaceRevision] = useState(0);
  return <FluentProvider className="app-provider" theme={workspaceTheme}>
    <EmployeeProfileProvider onOpenProfile={() => undefined}>
      <EmployeesView token="qa-no-real-token"
        currentUser={{ id: "admin", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "brand" }}
        allowAdministration onInvite={() => undefined}
        onDepartmentChanged={() => setWorkspaceRevision((value) => value + 1)} />
    </EmployeeProfileProvider>
  </FluentProvider>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
