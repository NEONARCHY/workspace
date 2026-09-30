// Development-only viewport fixture: the real task help inside a scrolled Fluent dialog.
import { createRoot } from "react-dom/client";
import { Dialog, DialogSurface, FluentProvider } from "@fluentui/react-components";
import { TaskHelp } from "../src/renderer/TasksView";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/design-system.css";
import "../src/renderer/styles.css";
import "../src/renderer/workspace-2-tasks.css";

createRoot(document.getElementById("root")!).render(
  <FluentProvider theme={workspaceTheme}>
    <Dialog open>
      <DialogSurface style={{ height: "min(500px, calc(100vh - 30px))", overflow: "auto" }} aria-label="Тест карточки задачи">
        <div style={{ height: 800 }} aria-hidden="true" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Как учитывается срок</strong>
          <TaskHelp title="Как учитывается срок">
            Это не настройка дедлайна, а объяснение показателя своевременного выполнения. Сдача до срока учитывается каждому исполнителю; возврат на доработку снимает зачёт до новой сдачи.
          </TaskHelp>
        </div>
      </DialogSurface>
    </Dialog>
  </FluentProvider>,
);
