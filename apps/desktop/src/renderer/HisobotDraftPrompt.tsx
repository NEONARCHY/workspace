import { useEffect, useRef, useState } from "react";
import type { HisobotActivityDraft, WorkspaceNotification } from "@yuksalish/contracts";
import { Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { Copy24Regular, Dismiss24Regular, DocumentBulletList24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { acknowledgeHisobotActivityDraft, loadHisobotActivityDraft } from "./workspace-api";

export interface HisobotDraftHandoff {
  readonly content: string;
  readonly reportDate: string;
  readonly revision: number;
}

export function currentHisobotReminderDay(notifications: readonly WorkspaceNotification[], now = new Date()): string | undefined {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const [day, clock] = parts.split(" ");
  if (!day || !clock || clock < "17:40" || clock >= "18:30") return undefined;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return undefined;
  return notifications.some(item => item.kind === "hisobot" && item.isReminder && item.requiresAction
    && !item.resolvedAt && new Date(item.occurredAt) <= now
    && new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tashkent" }).format(new Date(item.occurredAt)) === day)
    ? day : undefined;
}

export function HisobotDraftPrompt({ token, userId, notifications, enabled, editingReport, onEdit }: {
  readonly token: string;
  readonly userId: string;
  readonly notifications: readonly WorkspaceNotification[];
  readonly enabled: boolean;
  readonly editingReport: boolean;
  readonly onEdit: (draft: HisobotDraftHandoff) => void;
}) {
  const reminderDay = enabled ? currentHisobotReminderDay(notifications) : undefined;
  const [draft, setDraft] = useState<HisobotActivityDraft>();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const loadedKey = useRef("");
  const dismissedKey = useRef("");

  useEffect(() => {
    if (!reminderDay) return undefined;
    let active = true;
    const key = `${userId}:${reminderDay}`;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadHisobotActivityDraft(token).then(result => {
        if (!active || !result || result.reportDate !== reminderDay) return;
        setDraft(result);
        if (loadedKey.current !== key) {
          loadedKey.current = key;
          setText(result.content);
        }
        if (!editingReport && !result.seenAt && dismissedKey.current !== key) setOpen(true);
        setError("");
      }).catch(() => {
        if (active) setError("Не удалось загрузить черновик отчёта. Можно повторить загрузку или написать отчёт вручную.");
      });
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); };
  }, [token, userId, reminderDay, editingReport, attempt]);

  const acknowledge = () => {
    if (!draft) return;
    dismissedKey.current = `${userId}:${draft.reportDate}`;
    void acknowledgeHisobotActivityDraft(token, draft.reportDate).catch(() => {
      setError("Не удалось сохранить отметку о просмотре. При следующем входе предложение может появиться снова.");
    });
  };
  const close = () => { acknowledge(); setOpen(false); };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Текст скопирован. Отчёт ещё не отправлен.");
      setError("");
      acknowledge();
    } catch {
      setError("Не удалось скопировать. Выделите текст и скопируйте его вручную.");
    }
  };
  if (!reminderDay) return null;
  const readyDraft = draft?.reportDate === reminderDay ? draft : undefined;
  return <>
    {!editingReport && <aside className="hisobot-draft-nudge" aria-label="Черновик ежедневного отчёта">
      <DocumentBulletList24Regular aria-hidden="true" /><span><strong>AI Hisobot · {readyDraft ? "черновик отчёта готов" : "время подготовить отчёт"}</strong><small>По вашим действиям в Workspace. Отправка — только после проверки.</small></span>
      <Button onClick={() => readyDraft ? setOpen(true) : setAttempt(value => value + 1)}>{readyDraft ? "Посмотреть" : "Загрузить черновик"}</Button>
      {error && !open && <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => setAttempt(value => value + 1)}>Повторить</Button>}>{error}</WorkspaceNotice>}
    </aside>}
    <WorkspaceDialog open={Boolean(open && readyDraft)} onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface className="hisobot-draft-dialog"><DialogBody>
        <DialogTitle action={<Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть черновик отчёта" onClick={close} />}>Ваш отчёт уже собран в черновик</DialogTitle>
        <DialogContent>
          <p>Собрали подтверждённые действия за {draft?.reportDate.split("-").reverse().join(".")}. Проверьте текст и дополните работу вне Workspace. Ничего не отправлено.</p>
          <p className="hisobot-draft-meta">Действий: {draft?.activityCount ?? 0} · Снимок на {draft && new Date(draft.generatedAt).toLocaleTimeString("ru-RU", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" })}</p>
          {draft?.activityCount === 0 && <WorkspaceNotice tone="info">За сегодня нет зафиксированных действий в доступных разделах. Это не означает, что вы не работали — добавьте выполненное вручную.</WorkspaceNotice>}
          {Boolean(draft?.omittedCount) && <WorkspaceNotice tone="warning">Не поместилось действий: {draft?.omittedCount}. Дополните текст перед отправкой.</WorkspaceNotice>}
          <label htmlFor="hisobot-ready-draft">Готовый текст — можно редактировать сразу</label>
          <textarea id="hisobot-ready-draft" value={text} onChange={event => { setText(event.target.value); setNotice(""); }} />
          {error && <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice>}
          {notice && <p role="status">{notice}</p>}
        </DialogContent>
        <DialogActions>
          <Button icon={<Copy24Regular />} onClick={() => void copy()} disabled={!text.trim()}>Скопировать</Button>
          <Button appearance="primary" onClick={() => {
            if (!draft) return;
            onEdit({ content: text, reportDate: draft.reportDate, revision: Date.now() });
            close();
          }}>Открыть в AI Hisobot</Button>
          <Button appearance="subtle" onClick={close}>Позже</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </WorkspaceDialog>
  </>;
}
