// Development-only fixture. The browser test intercepts every API request.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import { AccountPanel } from "../src/renderer/AccountPanel";
import { EmployeeProfileDialog } from "../src/renderer/EmployeeProfileDialog";
import { WorkspaceSelect } from "../src/renderer/WorkspaceSelect";
import { DialogResizeMotion } from "../src/renderer/DialogResizeMotion";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/responsive.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/account-settings.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/profile-header.css";
import "../src/renderer/motion.css";

function Fixture() {
  const [profile, setProfile] = useState(false);
  const [invite, setInvite] = useState(false);
  const [role, setRole] = useState("executor");
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <DialogResizeMotion />
    <div className="tasks-view bp5-tasks" style={{ padding: 20 }}>
      <div className="section-toolbar"><WorkspaceSelect className="task-role-filter" aria-label="Роль в задаче" value={role} onChange={(event) => setRole(event.target.value)}><option value="executor">Я исполнитель</option><option value="coexecutor">Я соисполнитель</option></WorkspaceSelect></div>
      <Button onClick={() => setProfile(true)}>Открыть профиль</Button>
      <Button onClick={() => setInvite(true)}>Пригласить сотрудника</Button>
    </div>
    {profile ? <EmployeeProfileDialog token="qa-only" userId="qa-person" currentUserId="qa-person" open onOpenChange={setProfile} /> : null}
    {invite ? <AccountPanel token="qa-only" initialSection="invite" user={{ id: "qa-admin", username: "qa", name: "Тестовый администратор", initials: "ТА", role: "admin", color: "#0091a8" }} onClose={() => setInvite(false)} onLogout={() => undefined} /> : null}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
