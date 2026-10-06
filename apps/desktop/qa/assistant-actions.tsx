// Synthetic form handoff only. No provider or real Workspace data is contacted.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { AssistantActionDraft } from "@yuksalish/contracts";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { TaskComposer } from "../src/renderer/TaskComposer";
import { TripApprovalsView } from "../src/renderer/TripApprovalsView";
import { ProjectHubView } from "../src/renderer/ProjectHubView";
import { AbsencesView } from "../src/renderer/AbsencesView";
import { resolveAssistantForm } from "../src/renderer/assistant-form-handoff";
import { people } from "../src/renderer/test-fixtures/demo-data";
import { workspaceTheme } from "../src/renderer/workspace-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/motion.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/project-hub.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/project-workspace.css";

const examples: Readonly<Record<string, AssistantActionDraft>> = {
  task: { kind: "task", ready: true, fields: { title: "Тестовая задача: проверить отчёт", description: "Сверить цифры и подготовить итог.",
    assignee: people[1]!.name, dueAt: "2030-10-10T18:00", priority: "high", project: "Тестовый форум",
    coAssignees: people[2]!.name, observers: people[0]!.name, checklist: "Сверить цифры\nПодготовить итог" } },
  project: { kind: "project", ready: true, fields: { title: "Тестовый форум", code: "QA-FORUM", manager: people[1]!.name,
    description: "Только пример заполнения формы", startDate: "2030-10-01", endDate: "2030-10-30",
    budget: "2500000", currency: "UZS", accessStatus: "closed", responsibles: people[2]!.name,
    approvers: `${people[2]!.name}\n${people[1]!.name}` } },
  trip: { kind: "trip", ready: true, fields: { purpose: "Тестовая рабочая встреча", destination: "Навои", startDate: "2030-10-12",
    endDate: "2030-10-13", employees: `${people[1]!.name}\n${people[2]!.name}` } },
  absence: { kind: "absence", ready: true, fields: { reason: "Тестовый личный вопрос", absenceKind: "personal_time",
    startDate: "2030-10-14T14:00", endDate: "2030-10-14T16:00" } },
};
const networkFetch = window.fetch.bind(window);
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
}));
let capture: (data: unknown) => void = () => undefined;
window.fetch = (resource, options) => {
  const url = new URL(resource instanceof Request ? resource.url : String(resource), location.href);
  if (!url.pathname.startsWith("/api/")) return networkFetch(resource, options);
  if (url.pathname === "/api/v1/assistant/chats") return json([{ id: "qa-forms", title: "Проверка форм",
    isDefault: true, createdAt: "2030-01-01T00:00:00Z", updatedAt: "2030-01-01T00:00:00Z" }]);
  if (url.pathname === "/api/v1/assistant/messages" && options?.method === "POST") {
    const request = JSON.parse(String(options.body)) as { action_kind?: string; message: string;
      attachment?: { mime_type: string; as_prompt?: boolean } };
    if (request.attachment?.mime_type === "audio/webm" && !request.attachment.as_prompt && request.message.trim()) {
      return json({ id: `qa-${Date.now()}`, role: "assistant", model: "flash-lite", createdAt: new Date().toISOString(),
        content: "Стенд: пример ответа на текстовое задание для аудио. Запись здесь не распознаётся, команды из неё не выполняются." });
    }
    const kind = request.action_kind ?? (/проект/i.test(request.message) ? "project" : /поезд|командиров/i.test(request.message)
      ? "trip" : /отгул|отсутств/i.test(request.message) ? "absence" : "task");
    return json({ id: `qa-${Date.now()}`, role: "assistant", model: "flash-lite", createdAt: new Date().toISOString(),
      content: "На стенде подставлен фиксированный пример, не ответ ИИ. Проверьте поля и напишите «Открывай форму».", actionDraft: examples[kind] });
  }
  if (url.pathname === "/api/v1/assistant/messages") return json([]);
  if (url.pathname === "/api/v1/project-hub/requests") return json([]);
  if (url.pathname === "/api/v1/project-hub") return json({ projects: [], workstreams: [], items: [], requests: [] });
  if (url.pathname === "/api/v1/project-hub/projects" && options?.method === "POST") {
    const input = JSON.parse(String(options.body)) as Record<string, unknown>;
    capture(input);
    return json({ ...input, id: "qa-project", creatorUserId: people[0]!.id, canEdit: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  return json({ detail: "Стенд: настоящая отправка отключена." }, 403);
};

function Preview() {
  const [prepared, setPrepared] = useState<AssistantActionDraft>();
  const [confirmed, setConfirmed] = useState<unknown>();
  capture = (input: unknown) => { setConfirmed(input); setPrepared(undefined); };
  // This is a dry run: capture the real form payload, then close the example.
  // Returning no record is intentional; no server creation is simulated.
  const record = async (input: unknown) => { setConfirmed(input); setPrepared(undefined); return undefined; };
  return <FluentProvider theme={workspaceTheme} className="app-provider">
    <main style={{ padding: 20, minHeight: "100dvh", background: "#eef5f5" }}>
      <header className="global-bar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <div><h1 style={{ fontSize: 22 }}>Ассистент → настоящая форма</h1><p>Тестовый стенд: фиксированные примеры, без ИИ-провайдера и рабочих данных.</p>
          <p>Нажмите орбу → выберите действие → отправьте запрос → напишите «Открывай форму».</p></div>
        <YuksalishAssistant token="qa-forms-only" onPrepareAction={(action) => {
          setConfirmed(undefined); setPrepared(resolveAssistantForm(action, people, people[0]!.id));
        }} />
      </header>
      {prepared && <button type="button" onClick={() => setPrepared(undefined)}>Закрыть пример формы</button>}
      {prepared?.kind === "task" && <TaskComposer open people={people} tasks={[]} currentUserId={people[0]!.id}
        initialTitle={prepared.fields.title} initialDescription={prepared.fields.description}
        initialAssigneeName={prepared.fields.assignee} initialDueAt={prepared.fields.dueAt}
        assistantFields={prepared.fields} sourceLabel="Тестовый черновик ассистента"
        onClose={() => setPrepared(undefined)} onSubmit={record} />}
      {prepared?.kind === "project" && <ProjectHubView key={JSON.stringify(prepared)} mode="projects" token="qa-forms-only"
        people={people} currentUserId={people[0]!.id} canCreateProject canCreateRequest={false} assistantDraft={prepared} />}
      {prepared?.kind === "trip" && <TripApprovalsView key={JSON.stringify(prepared)} requests={[]} people={people}
        currentUser={people[0]!} onCreate={record} onUpdate={record} onAction={record} assistantDraft={prepared} />}
      {prepared?.kind === "absence" && <AbsencesView key={JSON.stringify(prepared)} currentUserId={people[0]!.id} people={people}
        requests={[]} summary={[]} canAdmin={false} onCreate={record} onAction={record}
        onUploadDocument={async () => undefined} assistantDraft={prepared} />}
      {confirmed !== undefined && <section aria-label="Подтверждённые тестовые данные" role="status">
        <h2>Данные собраны. Настоящая запись не создана.</h2><pre>{JSON.stringify(confirmed, null, 2)}</pre>
      </section>}
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
