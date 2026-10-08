import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  NotificationKind,
  AbsenceAction,
  AbsenceRequest,
  NotificationPreferences,
  WorkspaceNotification,
} from "@yuksalish/contracts";
import { workspacePlatform } from "./platform-adapter";
import { workspaceSounds } from "./workspace-sounds";
import { SlidingSegmented } from "./SlidingSegmented";
import { useContextMotion } from "./useContextMotion";
import { SwipeRow } from "./SwipeRow";
import { UndoActionsToast, useUndoActions } from "./UndoActions";
import { Button, Input, Switch } from "@fluentui/react-components";
import {
  AlertOn24Regular,
  Airplane24Regular,
  ApprovalsApp24Regular,
  CalendarLtr24Regular,
  PersonAvailable24Regular,
  Chat24Regular,
  ChatHelp24Regular,
  CheckmarkCircle24Regular,
  Search24Regular,
  TaskListSquareLtr24Regular,
  Video24Regular,
  News24Regular,
} from "@fluentui/react-icons";

type NotificationFilter = "attention" | "unread" | "all";
type NotificationKindFilter = NotificationKind | "all";

interface NotificationCenterProps {
  readonly focusNotification?: { readonly id: string; readonly revision: number };
  readonly notifications: readonly WorkspaceNotification[];
  readonly preferences: NotificationPreferences;
  readonly onOpen: (notification: WorkspaceNotification) => void | Promise<void>;
  readonly onMarkRead: (notification: WorkspaceNotification) => void | Promise<void>;
  readonly onMarkAllRead: () => void | Promise<void>;
  readonly onDelete?: (notification: WorkspaceNotification) => Promise<void>;
  readonly onUpdatePreferences: (
    preferences: NotificationPreferences,
  ) => void | Promise<void>;
  readonly onTestSystemNotification?: () => Promise<void>;
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
  hisobot: "AI Hisobot",
  support: "Поддержка",
  birthday: "Дни рождения",
  feed: "Лента",
};

function NotificationIcon({ kind }: { readonly kind: NotificationKind }) {
  if (kind === "feed") return <News24Regular />;
  if (kind === "message") return <Chat24Regular />;
  if (kind === "task") return <TaskListSquareLtr24Regular />;
  if (kind === "approval") return <ApprovalsApp24Regular />;
  if (kind === "trip") return <Airplane24Regular />;
  if (kind === "absence") return <PersonAvailable24Regular />;
  if (kind === "zoom") return <Video24Regular />;
  if (kind === "hisobot") return <TaskListSquareLtr24Regular />;
  if (kind === "support") return <ChatHelp24Regular />;
  if (kind === "birthday") return <CalendarLtr24Regular />;
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
  focusNotification,
  notifications,
  preferences,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  onDelete,
  onUpdatePreferences,
  onTestSystemNotification,
  absenceRequests = [],
  onAbsenceAction,
}: NotificationCenterProps) {
  const undo = useUndoActions();
  const pending = undo.pending;
  const available = useMemo(() => notifications.filter(item => !pending.some(action => action.scope === "notification" && action.id === item.id)), [notifications, pending]);
  const [filter, setFilter] = useState<NotificationFilter>(focusNotification ? "all" : "attention");
  const [kindFilter, setKindFilter] = useState<NotificationKindFilter>("all");
  const [query, setQuery] = useState("");
  const streamMotion = useContextMotion(`${filter}:${kindFilter}`);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [volumeDraft, setVolumeDraft] = useState<{ base: number; value: number }>();
  const volume = volumeDraft?.base === (preferences.soundVolume ?? 20) ? volumeDraft.value : preferences.soundVolume ?? 20;
  const [soundStatus, setSoundStatus] = useState<{ message: string; error: boolean }>();
  const [testingNotification, setTestingNotification] = useState(false);
  const [testStatus, setTestStatus] = useState<{ readonly message: string; readonly error: boolean }>();
  const [contextId, setContextId] = useState<string | undefined>(focusNotification?.id);
  const contextRef = useRef<HTMLElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!contextId) return;
    contextRef.current?.scrollIntoView?.({ block: "nearest" });
    contextRef.current?.focus({ preventScroll: true });
  }, [contextId]);
  const context = available.find(item => item.id === contextId);
  const unreadCount = available.filter((item) => !item.readAt).length;
  const attentionCount = available.filter(
    (item) => item.requiresAction && !item.resolvedAt,
  ).length;

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return available.filter((item) => {
      if (filter === "attention" && (!item.requiresAction || item.resolvedAt)) return false;
      if (filter === "unread" && item.readAt) return false;
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      return !normalized
        || item.title.toLocaleLowerCase("ru-RU").includes(normalized)
        || item.body.toLocaleLowerCase("ru-RU").includes(normalized);
    });
  }, [filter, kindFilter, available, query]);
  const availableKinds = useMemo(
    () => [...new Set(available.map((item) => item.kind))],
    [available],
  );
  const readCount = available.length - unreadCount;
  // Reading and completing a working action are independent. Never round an
  // outstanding unread item up to 100%, even in a large loaded history.
  const readPercent = available.length === 0 ? 0 : unreadCount === 0 ? 100
    : Math.min(99, Math.round(readCount / available.length * 100));

  const updatePreference = async (
    key: Exclude<keyof NotificationPreferences, "soundVolume">,
    checked: boolean,
  ) => {
    setSavingPreferences(true);
    try {
      await onUpdatePreferences({ ...preferences, [key]: checked });
    } catch (failure) {
      setSoundStatus({ message: failure instanceof Error ? failure.message : "Не удалось сохранить настройки", error: true });
    } finally {
      setSavingPreferences(false);
    }
  };

  const preferenceRows: readonly [
    Exclude<keyof NotificationPreferences, "soundVolume" | "soundEnabled">,
    string,
    string,
  ][] = [
    [
      "desktopEnabled",
      workspacePlatform.kind === "web" ? "Системные уведомления браузера" : "Уведомления Windows",
      workspacePlatform.kind === "web"
        ? "Показывать обычные события после разрешения браузера; AI Hisobot обязателен"
        : "Показывать обычные события поверх окон; AI Hisobot остаётся обязательным",
    ],
    ["messagesEnabled", "Сообщения", "Новые сообщения в доступных чатах"],
    ["feedEnabled", "Лента", "Объявления сотрудников; отключение не удаляет прежние уведомления"],
    ["tasksEnabled", "Задачи", "Назначения, возвраты и сроки"],
    ["approvalsEnabled", "Заявки", "Этапы, где требуется ваше решение"],
    ["tripsEnabled", "Командировки", "Согласование и возврат на доработку"],
    ["calendarEnabled", "Календарь", "Предстоящие встречи и события"],
    ["absencesEnabled", "Отсутствия", "Заявки, решения и больничные документы"],
    ["zoomEnabled", "Zoom-конференции", "Напоминание перед началом конференции"],
    ["remindersEnabled", "Напоминания", "Сроки в ближайшие 24 часа, кроме обязательных AI Hisobot"],
  ];

  return (
    <section className="workspace-view notifications-view" aria-label="Центр уведомлений">
      <WorkspaceSectionHeader motif="notifications" className="notification-header">
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
      </WorkspaceSectionHeader>

      <div className="notification-metrics" aria-label="Сводка уведомлений">
        <button
          className={filter === "attention" ? "active" : ""}
          aria-pressed={filter === "attention"}
          type="button"
          onClick={() => setFilter("attention")}
        >
          <strong>{attentionCount}</strong>
          <span><b>Нужно решить</b><small>Рабочие действия</small></span>
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          aria-pressed={filter === "unread"}
          type="button"
          onClick={() => setFilter("unread")}
        >
          <strong>{unreadCount}</strong>
          <span><b>Новые уведомления</b><small>Ещё не просмотрены</small></span>
        </button>
        <button
          className={filter === "all" ? "active" : ""}
          aria-pressed={filter === "all"}
          type="button"
          onClick={() => setFilter("all")}
        >
          <strong>{available.length}</strong>
          <span><b>Вся история</b><small>Доступные события</small></span>
        </button>
        <div className="notification-progress-card" role="group" aria-label="Прочтение уведомлений">
          <span><b>Прочитано уведомлений</b><small>{available.length === 0 ? "Пока нет уведомлений" : `${readCount} из ${available.length} просмотрены`}</small></span>
          <strong>{available.length === 0 ? "—" : `${readPercent}%`}</strong>
          <i role="progressbar" aria-label="Доля прочитанных уведомлений" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readPercent} aria-valuetext={available.length === 0 ? "Пока нет уведомлений" : `${readCount} из ${available.length} прочитаны`}><span style={{ width: `${readPercent}%` }} /></i>
        </div>
      </div>

      <div className="notification-layout">
        <div className="notification-stream-shell">
          <div className="notification-stream-toolbar">
            <div>
              <strong>{filter === "attention" ? "Очередь решений" : filter === "unread" ? "Непрочитанное" : "Все события"}</strong>
              <span>{visible.length} {visible.length === 1 ? "событие" : "событий"}</span>
            </div>
            <SlidingSegmented className="notification-kind-filters" role="group" aria-label="Фильтр по разделу">
              <button type="button" aria-pressed={kindFilter === "all"} onClick={() => setKindFilter("all")}>Все разделы</button>
              {availableKinds.map((kind) => (
                <button key={kind} type="button" aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)}>
                  <NotificationIcon kind={kind} />
                  {kindLabels[kind]}
                </button>
              ))}
            </SlidingSegmented>
          </div>
          <div className="notification-stream" aria-live="polite" ref={streamMotion}>
          {visible.length === 0 ? (
            <div className="notification-empty">
              <CheckmarkCircle24Regular />
              <strong>{filter === "attention" ? "Сейчас ничего не требует решения" : "Уведомлений нет"}</strong>
              <span>Новые события появятся здесь автоматически.</span>
            </div>
          ) : visible.map((notification) => (
            <SwipeRow key={notification.id} className="notification-swipe" label={`Удалить: ${notification.title}`} disabled={!onDelete}
              onAction={() => { if (onDelete) undo.enqueue({ id: notification.id, scope: "notification", label: "Уведомление удалено", commit: () => onDelete(notification) }); }}>
            <article
              className={`notification-row priority-${notification.priority} ${notification.readAt ? "read" : "unread"}`}
              key={notification.id}
            >
              <span className="list-row-hover-wash" aria-hidden="true" />
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
            </SwipeRow>
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
                  checked={preferences[key] !== false}
                  disabled={savingPreferences}
                  onChange={(_, data) => void updatePreference(key, data.checked)}
                />
              </label>
            ))}
          </div>
          <div className="notification-sound-settings">
            <Switch label="Звуки уведомлений" checked={preferences.soundEnabled !== false} disabled={savingPreferences}
              onChange={(_, data) => void updatePreference("soundEnabled", data.checked)} />
            <label><span>Громкость: {volume}%</span><input type="range" aria-label="Громкость уведомлений" min={0} max={100} step={5}
              value={volume} onChange={event => setVolumeDraft({ base: preferences.soundVolume ?? 20, value: Number(event.target.value) })} /></label>
            <div><Button size="small" disabled={savingPreferences || volume === (preferences.soundVolume ?? 20)} onClick={() => {
              setSavingPreferences(true); setSoundStatus(undefined);
            void Promise.resolve().then(() => onUpdatePreferences({ ...preferences, soundVolume: volume })).then(() => {
                setSoundStatus({ message: "Громкость сохранена", error: false });
              }).catch((failure: unknown) => setSoundStatus({ message: failure instanceof Error ? failure.message : "Не удалось сохранить громкость", error: true }))
                .finally(() => setSavingPreferences(false));
            }}>Сохранить громкость</Button> <Button size="small" onClick={() => {
              void workspaceSounds.preview(volume).then(() => setSoundStatus({ message: "Звук воспроизведён", error: false }))
                .catch((failure: unknown) => setSoundStatus({ message: failure instanceof Error ? failure.message : "Не удалось воспроизвести звук", error: true }));
            }}>Проверить звук</Button></div>
            {soundStatus && <p role={soundStatus.error ? "alert" : "status"}>{soundStatus.message}</p>}
          </div>
          {onTestSystemNotification ? <div className="notification-test">
            <Button size="small" disabled={testingNotification} onClick={() => {
              setTestingNotification(true);
              setTestStatus(undefined);
              void onTestSystemNotification().then(() => {
                setTestStatus({ message: "Проверочное уведомление отправлено в Windows. Если баннер не появился, проверьте разрешения браузера и режим «Не беспокоить» в Windows.", error: false });
              }).catch((failure: unknown) => {
                setTestStatus({ message: failure instanceof Error ? failure.message : "Не удалось показать уведомление.", error: true });
              }).finally(() => setTestingNotification(false));
            }}>{testingNotification ? "Проверяем…" : "Проверить уведомление"}</Button>
            {testStatus ? <p role={testStatus.error ? "alert" : "status"}>{testStatus.message}</p> : null}
          </div> : null}
          <p className="notification-settings-note">
            Отключение звука не удаляет события. Отключение канала ленты останавливает новые уведомления о публикациях. Системные уведомления приходят, пока сайт открыт; нужны HTTPS и разрешение браузера.
          </p>
        </aside>
      </div>
      {!undo.isShared ? <UndoActionsToast manager={undo} /> : null}
    </section>
  );
}
