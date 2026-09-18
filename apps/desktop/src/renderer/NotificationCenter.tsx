import { useEffect, useMemo, useRef, useState } from "react";

import type {
  NotificationKind,
  AbsenceAction,
  AbsenceRequest,
  NotificationPreferences,
  WorkspaceNotification,
} from "@yuksalish/contracts";
import { workspacePlatform } from "./platform-adapter";
import { Button, Input, Switch } from "@fluentui/react-components";
import {
  AlertOn24Regular,
  Airplane24Regular,
  ApprovalsApp24Regular,
  CalendarLtr24Regular,
  PersonAvailable24Regular,
  Chat24Regular,
  CheckmarkCircle24Regular,
  Search24Regular,
  TaskListSquareLtr24Regular,
  Video24Regular,
} from "@fluentui/react-icons";

type NotificationFilter = "attention" | "unread" | "all";
type NotificationKindFilter = NotificationKind | "all";

interface NotificationCenterProps {
  readonly notifications: readonly WorkspaceNotification[];
  readonly preferences: NotificationPreferences;
  readonly onOpen: (notification: WorkspaceNotification) => void | Promise<void>;
  readonly onMarkRead: (notification: WorkspaceNotification) => void | Promise<void>;
  readonly onMarkAllRead: () => void | Promise<void>;
  readonly onUpdatePreferences: (
    preferences: NotificationPreferences,
  ) => void | Promise<void>;
  readonly absenceRequests?: readonly AbsenceRequest[];
  readonly onAbsenceAction?: (request: AbsenceRequest, action: AbsenceAction) => void | Promise<void>;
}

const kindLabels: Record<NotificationKind, string> = {
  message: "Мессенджер",
  task: "Задачи",
  approval: "Заявки на оплату",
  trip: "Командировки",
  calendar: "Календарь",
  absence: "Отсутствия",
  zoom: "Zoom-конференции",
};

function NotificationIcon({ kind }: { readonly kind: NotificationKind }) {
  if (kind === "message") return <Chat24Regular />;
  if (kind === "task") return <TaskListSquareLtr24Regular />;
  if (kind === "approval") return <ApprovalsApp24Regular />;
  if (kind === "trip") return <Airplane24Regular />;
  if (kind === "absence") return <PersonAvailable24Regular />;
  if (kind === "zoom") return <Video24Regular />;
  return <CalendarLtr24Regular />;
}

function timeLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

export function NotificationCenter({
  notifications,
  preferences,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onUpdatePreferences,
  absenceRequests = [],
  onAbsenceAction,
}: NotificationCenterProps) {
  const [filter, setFilter] = useState<NotificationFilter>("attention");
  const [kindFilter, setKindFilter] = useState<NotificationKindFilter>("all");
  const [query, setQuery] = useState("");
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [contextId, setContextId] = useState<string>();
  const contextRef = useRef<HTMLElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!contextId) return;
    contextRef.current?.scrollIntoView?.({ block: "nearest" });
    contextRef.current?.focus({ preventScroll: true });
  }, [contextId]);
  const context = notifications.find(item => item.id === contextId);
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const attentionCount = notifications.filter(
    (item) => item.requiresAction && !item.resolvedAt,
  ).length;

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return notifications.filter((item) => {
      if (filter === "attention" && (!item.requiresAction || item.resolvedAt)) return false;
      if (filter === "unread" && item.readAt) return false;
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      return !normalized
        || item.title.toLocaleLowerCase("ru-RU").includes(normalized)
        || item.body.toLocaleLowerCase("ru-RU").includes(normalized);
    });
  }, [filter, kindFilter, notifications, query]);
  const availableKinds = useMemo(
    () => [...new Set(notifications.map((item) => item.kind))],
    [notifications],
  );
  const completionPercent = notifications.length === 0
    ? 100
    : Math.round(((notifications.length - attentionCount) / notifications.length) * 100);

  const updatePreference = async (
    key: keyof NotificationPreferences,
    checked: boolean,
  ) => {
    setSavingPreferences(true);
    try {
      await onUpdatePreferences({ ...preferences, [key]: checked });
    } finally {
      setSavingPreferences(false);
    }
  };

  const preferenceRows: readonly [
    keyof NotificationPreferences,
    string,
    string,
  ][] = [
    [
      "desktopEnabled",
      workspacePlatform.kind === "web" ? "Системные уведомления браузера" : "Уведомления Windows",
      workspacePlatform.kind === "web"
        ? "Показывать новые события после явного разрешения браузера"
        : "Показывать новые события поверх других окон",
    ],
    ["messagesEnabled", "Сообщения", "Новые сообщения в доступных чатах"],
    ["tasksEnabled", "Задачи", "Назначения, возвраты и сроки"],
    ["approvalsEnabled", "Заявки", "Этапы, где требуется ваше решение"],
    ["tripsEnabled", "Командировки", "Согласование и возврат на доработку"],
    ["calendarEnabled", "Календарь", "Предстоящие встречи и события"],
    ["absencesEnabled", "Отсутствия", "Заявки, решения и больничные документы"],
    ["zoomEnabled", "Zoom-конференции", "Напоминание перед началом конференции"],
    ["remindersEnabled", "Напоминания", "Сроки в ближайшие 24 часа"],
  ];

  return (
    <section className="workspace-view notifications-view" aria-label="Центр уведомлений">
      <header className="notification-header">
        <div>
          <span className="notification-kicker">Центр внимания</span>
          <h1>Требует моего внимания</h1>
          <p>Одна спокойная очередь для решений, сроков и важных обновлений.</p>
        </div>
        <div className="notification-head-actions">
          <Input
            aria-label="Поиск уведомлений"
            contentBefore={<Search24Regular />}
            placeholder="Найти уведомление"
            value={query}
            onChange={(_, data) => setQuery(data.value)}
          />
          <Button
            appearance="subtle"
            disabled={unreadCount === 0}
            icon={<CheckmarkCircle24Regular />}
            onClick={() => void onMarkAllRead()}
          >
            Прочитать все
          </Button>
        </div>
      </header>

      <div className="notification-metrics" aria-label="Сводка уведомлений">
        <button
          className={filter === "attention" ? "active" : ""}
          type="button"
          onClick={() => setFilter("attention")}
        >
          <strong>{attentionCount}</strong>
          <span><b>Нужно решить</b><small>Рабочие действия</small></span>
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          type="button"
          onClick={() => setFilter("unread")}
        >
          <strong>{unreadCount}</strong>
          <span><b>Новые сигналы</b><small>Ещё не просмотрены</small></span>
        </button>
        <button
          className={filter === "all" ? "active" : ""}
          type="button"
          onClick={() => setFilter("all")}
        >
          <strong>{notifications.length}</strong>
          <span><b>Вся история</b><small>Доступные события</small></span>
        </button>
        <div className="notification-progress-card" aria-label={`Разобрано ${completionPercent}% уведомлений`}>
          <span><b>Ритм очереди</b><small>Разобрано без активного действия</small></span>
          <strong>{completionPercent}%</strong>
          <i><span style={{ width: `${completionPercent}%` }} /></i>
        </div>
      </div>

      <div className="notification-layout">
        <div className="notification-stream-shell">
          <div className="notification-stream-toolbar">
            <div>
              <strong>{filter === "attention" ? "Очередь решений" : filter === "unread" ? "Непрочитанное" : "Все события"}</strong>
              <span>{visible.length} {visible.length === 1 ? "событие" : "событий"}</span>
            </div>
            <div className="notification-kind-filters" role="group" aria-label="Фильтр по разделу">
              <button type="button" aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>Все разделы</button>
              {availableKinds.map((kind) => (
                <button key={kind} type="button" aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>
                  <NotificationIcon kind={kind} />
                  {kindLabels[kind]}
                </button>
              ))}
            </div>
          </div>
          <div className="notification-stream" aria-live="polite">
          {visible.length === 0 ? (
            <div className="notification-empty">
              <CheckmarkCircle24Regular />
              <strong>{filter === "attention" ? "Сейчас ничего не требует решения" : "Уведомлений нет"}</strong>
              <span>Новые события появятся здесь автоматически.</span>
            </div>
          ) : visible.map((notification) => (
            <article
              className={`notification-row priority-${notification.priority} ${notification.readAt ? "read" : "unread"}`}
              key={notification.id}
            >
              <span className={`notification-kind kind-${notification.kind}`}>
                <NotificationIcon kind={notification.kind} />
              </span>
              <button
                className="notification-open"
                type="button"
                onClick={() => void onOpen(notification)}
              >
                <span className="notification-row-meta">
                  <strong>{kindLabels[notification.kind]}</strong>
                  {notification.requiresAction && !notification.resolvedAt ? <em>нужно действие</em> : null}
                  {notification.resolvedAt ? <em className="resolved">выполнено</em> : null}
                </span>
                <b>{notification.title}</b>
                <p>{notification.body}</p>
                <span className="notification-open-label">Открыть рабочий контекст →</span>
              </button>
              <div className="notification-row-tail">
                {notification.kind === "absence" && notification.requiresAction && !notification.resolvedAt
                  ? absenceRequests.filter(request => request.id === notification.entityId).map(request => (
                    <span key={request.id} className="notification-quick-actions">
                      {request.allowedActions.includes("approve") ? <Button size="small" appearance="primary" onClick={() => void onAbsenceAction?.(request, "approve")}>Согласовать</Button> : null}
                      {request.allowedActions.includes("acknowledge") ? <Button size="small" appearance="primary" onClick={() => void onAbsenceAction?.(request, "acknowledge")}>Подтвердить</Button> : null}
                      {request.allowedActions.includes("reject") ? <Button size="small" onClick={() => void onOpen(notification)}>Отклонить…</Button> : null}
                    </span>
                  )) : null}
                <Button appearance="subtle" size="small" aria-label={`Контекст: ${notification.title}`} aria-pressed={contextId === notification.id} onClick={event => { contextTrigger.current = event.currentTarget; setContextId(notification.id); }}>Подробнее</Button>
                <time dateTime={notification.occurredAt}>{timeLabel(notification.occurredAt)}</time>
                {!notification.readAt ? (
                  <button
                    aria-label={`Отметить прочитанным: ${notification.title}`}
                    className="notification-read-action"
                    type="button"
                    onClick={() => void onMarkRead(notification)}
                  >
                    <span />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          </div>
        </div>

        <aside className="notification-settings" aria-label="Настройки уведомлений">
          {context ? <section ref={contextRef} tabIndex={-1} className="notification-context" key={context.id} aria-label="Контекст уведомления">
            <div><span>{kindLabels[context.kind]}</span><button type="button" aria-label="Закрыть контекст уведомления" onClick={() => { setContextId(undefined); contextTrigger.current?.focus(); }}>×</button></div>
            <h2>{context.title}</h2><p>{context.body}</p><small>{new Date(context.occurredAt).toLocaleString("ru-RU")}</small>
            <Button appearance="primary" onClick={() => void onOpen(context)}>Открыть в разделе</Button>
          </section> : null}
          <div className="notification-settings-title">
            <AlertOn24Regular />
            <span><strong>Каналы доставки</strong><small>Настройте уровень шума под себя</small></span>
          </div>
          <div className="notification-preference-list">
            {preferenceRows.map(([key, label, description]) => (
              <label key={key}>
                <span><strong>{label}</strong><small>{description}</small></span>
                <Switch
                  aria-label={label}
                  checked={preferences[key]}
                  disabled={savingPreferences || (key !== "desktopEnabled" && !preferences.desktopEnabled)}
                  onChange={(_, data) => void updatePreference(key, data.checked)}
                />
              </label>
            ))}
          </div>
          <p className="notification-settings-note">
            Внутренний список сохраняется всегда. Эти настройки управляют только всплывающими уведомлениями Windows.
          </p>
        </aside>
      </div>
    </section>
  );
}
