import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { DossierReminder, DossierReminderAnswer, WorkspacePerson } from "@yuksalish/contracts";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { CalendarCheckmark24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { answerDossierReminder, loadDossierReminder } from "./workspace-api";
import "./dossier-reminder.css";

const DossierDialog = lazy(() => import("./DossierDialog").then(module => ({ default: module.DossierDialog })));

function validReminder(value: unknown): value is DossierReminder {
  return typeof value === "object" && value !== null
    && "period" in value && typeof value.period === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value.period)
    && "dueDate" in value && value.dueDate === `${value.period}-25`
    && "due" in value && typeof value.due === "boolean"
    && "status" in value && typeof value.status === "string"
    && ["pending", "update_requested", "no_changes", "skipped", "updated"].includes(value.status)
    && "respondedAt" in value && (value.respondedAt === null || typeof value.respondedAt === "string");
}

export function DossierReminderPrompt({ token, userId, people, paused = false }: {
  readonly token: string;
  readonly userId: string;
  readonly people: readonly WorkspacePerson[];
  readonly paused?: boolean;
}) {
  const [state, setState] = useState<DossierReminder>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorQueued, setEditorQueued] = useState(false);
  const [deferredPeriod, setDeferredPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const answering = useRef(false);
  const requestVersion = useRef({ version: 0 });
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (answering.current || document.visibilityState === "hidden") return;
    const version = ++requestVersion.current.version;
    try {
      const result = await loadDossierReminder(token);
      if (!validReminder(result)) return;
      if (alive.current && version === requestVersion.current.version) {
        setState(result); setError("");
        if (!result.due) setOpen(false);
      }
    } catch {
      // A background check must not block the workspace during an outage or API rollout.
      // Poll/focus retries it; explicit answer failures below remain visible and retryable.
    }
  }, [token]);

  useEffect(() => {
    const requests = requestVersion.current;
    const resume = () => { void refresh(); };
    const initial = window.setTimeout(resume, 0);
    const timer = window.setInterval(resume, 60_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      ++requests.version;
      window.clearTimeout(initial);
      window.clearInterval(timer); window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);

  useEffect(() => {
    if (!state?.due || paused || editing || editorQueued || open || deferredPeriod === state.period) return;
    const showWhenFree = () => {
      if (document.visibilityState === "hidden") return;
      const otherDialog = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]'))
        .some(dialog => !dialog.closest('[aria-hidden="true"]') && getComputedStyle(dialog).display !== "none");
      if (!otherDialog) setOpen(true);
    };
    const initial = window.setTimeout(showWhenFree, 0);
    // Only observe while a due reminder is waiting for an existing dialog to close.
    const observer = new MutationObserver(showWhenFree);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
    return () => { window.clearTimeout(initial); observer.disconnect(); };
  }, [state, paused, editing, editorQueued, open, deferredPeriod]);

  const answer = async (action: DossierReminderAnswer["action"]) => {
    if (!state || answering.current) return;
    answering.current = true; ++requestVersion.current.version; setBusy(true); setError("");
    try {
      const result = await answerDossierReminder(token, { period: state.period, action });
      if (!validReminder(result)) throw new Error("Сервер вернул некорректный ответ. Обновите напоминание перед повтором.");
      if (!alive.current) return;
      setState(result); setDeferredPeriod(result.period); setOpen(false);
      if (action === "update_requested" && result.status === "update_requested") setEditorQueued(true);
    } catch (value) {
      if (alive.current) setError(value instanceof Error ? value.message : "Не удалось сохранить ответ. Повторите попытку.");
    } finally {
      answering.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return <>
    {state?.due && deferredPeriod === state.period && !editing && !editorQueued && !open ? <aside className="dossier-reminder-resume" aria-label="Проверка объективки не завершена">
      <span>Проверка объективки ещё не завершена. Черновик не считается обновлением.</span>
      <Button onClick={() => { setDeferredPeriod(""); setOpen(true); }}>Продолжить проверку</Button>
    </aside> : null}
    <WorkspaceDialog open={open && Boolean(state?.due)}
      surfaceMotion={{ outScale: 1, inScale: 1, duration: 240, exitDuration: 160,
        easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.4, 0, 1, 1)",
        onMotionFinish: (_, data) => {
          if (data.direction === "exit" && editorQueued) { setEditorQueued(false); setEditing(true); }
        } }}
      onOpenChange={(_, data) => { if (open && !data.open && !answering.current) void answer("skipped"); }}>
      <DialogSurface className="dossier-reminder-dialog" aria-label="Ежемесячная проверка объективки"><DialogBody>
        <DialogTitle action={<Button appearance="subtle" icon={<Dismiss24Regular />} disabled={busy} aria-label="Пропустить проверку до следующего месяца" onClick={() => void answer("skipped")} />}>Пора проверить объективку</DialogTitle>
        <DialogContent role="region" aria-label="Как проверить объективку" tabIndex={0}>
          <div className="dossier-reminder-intro"><span className="dossier-reminder-icon"><CalendarCheckmark24Regular aria-hidden="true" /></span><div><span className="dossier-reminder-kicker">ЕЖЕМЕСЯЧНАЯ ПРОВЕРКА · {state?.period.split("-").reverse().join(".")}</span><h3>Были ли изменения в ваших данных?</h3></div></div>
          <p>Проверьте образование, должность, трудовую деятельность и другие сведения. Если что-то изменилось — обновите свою объективку.</p>
          <div className="dossier-reminder-explanation"><strong>Ваш ответ сохранится между устройствами</strong><p>«Изменений нет» и «Пропустить» закроют напоминание до следующего месяца. Пропуск не означает проверку данных.</p><p>При обновлении проверка завершится только после «Сохранить объективку». Черновик и простое открытие анкеты её не завершают.</p></div>
          {error ? <WorkspaceNotice tone="error" role="alert" actions={<Button disabled={busy} onClick={() => void refresh()}>Обновить напоминание</Button>}>{error} Ответ не подтверждён. Можно повторить действие.</WorkspaceNotice> : null}
          {busy ? <p role="status">Сохраняем ваш ответ…</p> : null}
        </DialogContent>
        <DialogActions><Button appearance="primary" disabled={busy} onClick={() => void answer("update_requested")}>Обновить объективку</Button><Button disabled={busy} onClick={() => void answer("no_changes")}>Изменений нет</Button><Button appearance="subtle" disabled={busy} onClick={() => void answer("skipped")}>Пропустить</Button>{error ? <Button appearance="subtle" onClick={() => { if (state) setDeferredPeriod(state.period); setOpen(false); }}>Закрыть только на этот сеанс</Button> : null}</DialogActions>
      </DialogBody></DialogSurface>
    </WorkspaceDialog>
    {editing ? <Suspense fallback={<p role="status">Открываем вашу объективку…</p>}><DossierDialog token={token} userId={userId} people={people} onClose={() => { setEditing(false); void refresh(); }} onSaved={record => { if (record.status === "saved") void refresh(); }} /></Suspense> : null}
  </>;
}
