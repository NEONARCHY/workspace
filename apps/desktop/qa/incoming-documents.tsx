import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { IncomingLettersView } from "../src/renderer/IncomingLettersView";
import { useQaTheme } from "./color-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/motion.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/dark-theme.css";
import "../src/renderer/satin-surfaces.css";

const people: readonly WorkspacePerson[] = [
  { id: "author", name: "Постановщик QA", initials: "П", role: "admin", color: "teal", status: "active" },
  { id: "executor", name: "Исполнитель QA", initials: "И", role: "employee", color: "blue", status: "active" },
  { id: "co", name: "Соисполнитель QA", initials: "С", role: "employee", color: "teal", status: "active" },
];

function Fixture() {
  const theme = useQaTheme();
  return <FluentProvider theme={theme} className="app-provider" style={{ height: "100dvh", overflow: "hidden", background: "var(--ws-canvas)" }}>
    <IncomingLettersView token="synthetic-qa-only" people={people} currentUserId="author" canEdit
      onOpenTask={async id => { document.documentElement.dataset.openedTask = id; }} />
  </FluentProvider>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
