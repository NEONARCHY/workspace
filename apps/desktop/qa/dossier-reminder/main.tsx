// Isolated synthetic UI lab. No authentication, real employee data or outgoing API calls.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { DossierDetail, DossierReminder, DossierReminderAnswer } from "@yuksalish/contracts";
import { DossierReminderPrompt } from "../../src/renderer/DossierReminderPrompt";
import { workspaceTheme, workspaceDarkTheme } from "../../src/renderer/workspace-theme";
import "../../src/renderer/styles.css";
import "../../src/renderer/responsive.css";
import "../../src/renderer/design-system.css";
import "../../src/renderer/spatial-workspace.css";
import "../../src/renderer/dark-theme.css";
import "../../src/renderer/satin-surfaces.css";
import "../../src/renderer/workspace-inputs.css";
import "../../src/renderer/workspace-field-borders.css";
import "../../src/renderer/workspace-modal-backdrops.css";

const initial: DossierReminder = { period: "2026-10", dueDate: "2026-10-25", due: true, status: "pending", respondedAt: null };
let reminder = initial;
let failNextAnswer = false;
let record: DossierDetail = {
  userId: "synthetic-self", fullName: "Тестовый Сотрудник", jobTitle: "Специалист", revision: 0,
  status: "empty", updatedAt: null, permissions: { canView: true, canEdit: true },
  fields: { birthDate: null, birthPlace: "", appointmentDate: null, nationality: "", partyMembership: "", educationLevel: "", education: [], employment: [], languages: "", academicDegree: "", academicTitle: "", militaryRank: "", electedMembership: "", awards: "", relatives: [], additionalInfo: "" },
};
window.fetch = async (input, init) => {
  const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
  let value: unknown;
  if (path.endsWith("/personnel-dossiers/reminder")) {
    if (init?.method === "POST") {
      if (failNextAnswer) { failNextAnswer = false; return new Response(JSON.stringify({detail:"Демонстрация ошибки: ответ не сохранён. Повторите действие."}),{status:503,headers:{"Content-Type":"application/json"}}); }
      const payload = JSON.parse(String(init.body)) as DossierReminderAnswer;
      reminder = { ...initial, status: payload.action, due: payload.action === "update_requested", respondedAt: "2026-10-25T09:00:00Z" };
    }
    value = reminder;
  } else if (path.endsWith("/synthetic-self/history")) value = [];
  else if (path.endsWith("/personnel-dossiers/synthetic-self")) {
    if (init?.method === "PUT") {
      const payload = JSON.parse(String(init.body)) as Pick<DossierDetail, "fields" | "revision"> & { status: "draft" | "saved" };
      record = { ...record, ...payload, revision: record.revision + 1 };
      if (payload.status === "saved") reminder = { ...initial, due: false, status: "updated", respondedAt: "2026-10-25T09:00:00Z" };
    }
    value = record;
  } else return new Response("Synthetic lab: no external API requests", {status:403});
  return new Response(JSON.stringify(value), {headers:{"Content-Type":"application/json"}});
};
const dark = new URLSearchParams(location.search).get("theme") === "dark";
document.documentElement.dataset.colorTheme = dark ? "dark" : "light";
function Lab() {
  const [revision, setRevision] = useState(0);
  return <FluentProvider theme={dark ? workspaceDarkTheme : workspaceTheme} className="app-provider" style={{ minHeight:"100dvh", padding:24, boxSizing:"border-box" }}>
    <main><h1>Предпросмотр · 25 октября 2026</h1><p>Демонстрационные данные. Календарь компьютера и рабочий сервер не меняются.</p><p>Проверьте три ответа, открытие своей объективки и сохранение. Никакие реальные данные не загружаются.</p>
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}><Button onClick={() => { reminder = initial; failNextAnswer = false; setRevision(value => value + 1); }}>Начать пример заново</Button><Button onClick={() => { reminder = initial; failNextAnswer = true; setRevision(value => value + 1); }}>Пример с ошибкой ответа</Button></div>
      <DossierReminderPrompt key={revision} token="synthetic-preview-only" userId="synthetic-self" people={[]} />
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Lab />);
