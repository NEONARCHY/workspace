import { Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import { EmployeeProfileDialog, prepareEmployeeProfile } from "../src/renderer/workspace-module-preload";
import { clearProfilePreload } from "../src/renderer/profile-preload";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import { DialogResizeMotion } from "../src/renderer/DialogResizeMotion";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/design-system.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/motion.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/profile-header.css";

// Browser test intercepts every API call; no real account or data is used.
function Fixture() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const stop = useRef<() => void>(() => undefined);
  useEffect(() => () => { stop.current(); clearProfilePreload(); }, []);
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <DialogResizeMotion />
    <Button onClick={() => { stop.current(); void prepareEmployeeProfile("qa-only", "qa-person").then((cancel) => { stop.current = cancel; setPrepared(true); }); }}>Прогреть профиль</Button>
    <Button onClick={() => { setMounted(true); setOpen(true); }}>Открыть профиль</Button>
    <span data-prepared={prepared}>{prepared ? "Готов" : "Без прогрева"}</span>
    {mounted ? <Suspense fallback={<span>Загрузка кода</span>}><EmployeeProfileDialog token="qa-only" userId="qa-person" currentUserId="qa-person" open={open} onOpenChange={setOpen} /></Suspense> : null}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
