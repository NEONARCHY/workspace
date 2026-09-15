import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RecoveryBoundary, reportDiagnostic } from "./RecoveryBoundary";
import "./styles.css";
import "./responsive.css";
import "./context-colors.css";
import "./personal-organization.css";
import "./design-system.css";
import "./record-composer.css";
import "./motion.css";
import "./record-lists.css";
import "./message-layout.css";
import "./team-dashboard.css";
import "./spatial-workspace.css";
import "./workspace-2-payments.css";
import "./workspace-2-workflow.css";
import "./workspace-2-projects-trips.css";
import "./workspace-2-projects-trips.css";
import "./desktop-updates.css";
import "./window-titlebar.css";
import "./web-platform.css";
import { workspacePlatform } from "./platform-adapter";

if (workspacePlatform.kind === "electron" && navigator.userAgent.includes("Windows")) {
  document.documentElement.classList.add("desktop-window-chrome");
}

window.addEventListener("error", (event) => reportDiagnostic("window-error", event.error));
window.addEventListener("unhandledrejection", (event) => reportDiagnostic("unhandled-rejection", event.reason));

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <RecoveryBoundary><App /></RecoveryBoundary>
  </StrictMode>,
);
