import { useEffect, useRef, useState } from "react";
import type { HisobotActivityDraft, WorkspaceNotification } from "@yuksalish/contracts";
import { Button, Portal } from "@fluentui/react-components";
import { Dismiss24Regular, DocumentBulletList24Regular } from "@fluentui/react-icons";
import { getApiBaseUrl } from "./api-origin";
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
  return notifications.some(item => item.kind === "hisobot" && item.section === "ai_hisobot" && item.isReminder && item.requiresAction
    && !item.resolvedAt && new Date(item.occurredAt) <= now
    && new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tashkent" }).format(new Date(item.occurredAt)) === day)
    ? day : undefined;
}

export function HisobotDraftPrompt({ token, userId, notifications, enabled, editingReport, paused = false, onEdit }: {
  readonly token: string;
  readonly userId: string;
  readonly notifications: readonly WorkspaceNotification[];
  readonly enabled: boolean;
  readonly editingReport: boolean;
  readonly paused?: boolean;
  readonly onEdit: (draft: HisobotDraftHandoff) => void;
}) {
  const reminderDay = enabled ? currentHisobotReminderDay(notifications) : undefined;
  const [draft, setDraft] = useState<HisobotActivityDraft>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const dismissedKey = useRef("");
  const storageKey = `hisobot-draft-prompt:${getApiBaseUrl()}:${userId}`;

  useEffect(() => {
    if (!reminderDay || editingReport || dismissedKey.current === reminderDay) return undefined;
    try { if (localStorage.getItem(storageKey) === reminderDay) return undefined; }
    catch { /* In-memory dismissal still works when storage is unavailable. */ }
    let active = true;
    let loading = false;
    const refresh = () => {
      if (document.visibilityState === "hidden" || loading || dismissedKey.current === reminderDay) return;
      loading = true;
      void loadHisobotActivityDraft(token).then(result => {
        if (!active || !result || result.reportDate !== reminderDay) return;
        setDraft(result);
        setOpen(!result.seenAt && dismissedKey.current !== reminderDay);
        setError("");
      }).catch(() => {
        if (active && dismissedKey.current !== reminderDay) {
          setError("Не удалось загрузить черновик. Повторите загрузку, когда будет удобно.");
          setOpen(true);
        }
      }).finally(() => { loading = false; });
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; document.removeEventListener("visibilitychange", refresh); };
  }, [token, storageKey, reminderDay, editingReport, attempt]);

  const close = () => {
    if (!reminderDay) return;
    dismissedKey.current = reminderDay;
    try { localStorage.setItem(storageKey, reminderDay); }
    catch { /* Keep the in-memory mark; closing never depends on a server request. */ }
    setOpen(false);
    if (draft?.reportDate === reminderDay) void acknowledgeHisobotActivityDraft(token, reminderDay).catch(() => {
      // Local dismissal is durable even if the cross-device acknowledgement fails.
      console.warn("AI Hisobot: не удалось синхронизировать отметку о просмотре черновика.");
    });
  };
  if (!reminderDay || !open || editingReport || paused) return null;
  const readyDraft = draft?.reportDate === reminderDay ? draft : undefined;
  if (!readyDraft && !error) return null;
  return <Portal><aside className="hisobot-draft-notice" role="region" aria-label="Черновик ежедневного отчёта" data-satin-excluded>
    <DocumentBulletList24Regular className="hisobot-draft-notice-icon" aria-hidden="true" />
    <div className="hisobot-draft-notice-copy">
      <span>AI Hisobot</span>
      <strong role="status">{error ? "Черновик пока недоступен" : readyDraft?.activityCount === 0 ? "Время подготовить отчёт" : "Черновик отчёта готов"}</strong>
      <p>{error || (readyDraft?.activityCount === 0 ? "За сегодня нет зафиксированных действий. Добавьте выполненную работу вручную." : "По вашим действиям за сегодня. Проверьте и дополните перед отправкой.")}</p>
      {error ? <Button onClick={() => setAttempt(value => value + 1)}>Повторить загрузку</Button>
        : <Button appearance="primary" onClick={() => {
          if (!readyDraft) return;
          onEdit({ content: readyDraft.content, reportDate: readyDraft.reportDate, revision: Date.now() });
          close();
        }}>Открыть AI Hisobot</Button>}
    </div>
    <Button className="hisobot-draft-notice-close" appearance="subtle" shape="circular" icon={<Dismiss24Regular />} aria-label="Закрыть уведомление AI Hisobot" onClick={close} />
  </aside></Portal>;
}
