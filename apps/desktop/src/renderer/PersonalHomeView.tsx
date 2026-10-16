import { WorkspaceNotice } from "./WorkspaceNotice";
import { ReactionEmoji } from "./ReactionEmoji";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { LoadingSkeleton, SkeletonBlock } from "./LoadingSkeleton";
import { ArrowRight20Regular, ArrowSync20Regular, CalendarLtr24Regular, Chat24Regular, Mail24Regular, PeopleTeam24Regular, Reward24Regular, TaskListSquareLtr24Regular } from "@fluentui/react-icons";
import type { NavigationKey, WorkspaceNotification, ZoomMeeting } from "@yuksalish/contracts";
import { HistoryChart, ScoreGauge } from "./EfficiencyView";
import { EmployeeProfileLink, useOpenEmployeeProfile } from "./EmployeeProfileLink";
import { ProfileAvatar } from "./ProfileAvatar";
import { RecognitionBadgeArtwork } from "./RecognitionBadgeArtwork";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { useContextMotion } from "./useContextMotion";
import { ApiHttpError, loadAIReferentIncomingRegistry, loadEdoIncomingLetters, loadEmployeeRecognitionProfile, loadPersonalEfficiency, loadPersonalReactions, loadProjectHub } from "./workspace-api";
import { buildPersonalHome, homeDate, homePeriod, rankHomePanels, timestamp, type HomePanelKey, type HomeTarget, type HomeWorkspace } from "./personal-home";
import "./personal-home.css";
import { personalGreetingName } from "./personal-greeting-name";

interface Props {
  readonly token: string;
  readonly workspace: HomeWorkspace;
  readonly canView: (key: NavigationKey) => boolean;
  readonly zoomMeetings?: readonly ZoomMeeting[];
  readonly zoomError?: string;
  readonly zoomLoading?: boolean;
  readonly onOpen: (target: HomeTarget) => void;
  readonly onOpenNotification: (notification: WorkspaceNotification) => void;
  readonly onRefresh: () => Promise<void>;
}

interface Resource<T> { readonly identity: string; readonly data?: T; readonly error?: string; readonly unavailable?: boolean }
function useResource<T>(identity: string, enabled: boolean, loader: () => Promise<T>, revision: number) {
  const [resource, setResource] = useState<Resource<T>>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.resolve().then(loader).then(data => {
      if (active) setResource({ identity, data });
    }).catch((error: unknown) => {
      const denied = error instanceof ApiHttpError && [401, 403].includes(error.status);
      if (active) setResource(current => ({ identity, data: !denied && current?.identity === identity ? current.data : undefined, error: error instanceof Error ? error.message : "Не удалось загрузить данные", unavailable: error instanceof ApiHttpError && error.status === 503 }));
    });
    return () => { active = false; };
  }, [enabled, identity, loader, revision]);
  return enabled && resource?.identity === identity ? resource : undefined;
}
function ResourceState({ loading, error, onRetry, efficiency = false }: { readonly loading: boolean; readonly error?: string; readonly onRetry: () => void; readonly efficiency?: boolean }) {
  return error ? <div className="home-empty" role="alert"><p>{error}</p><Button size="small" onClick={onRetry}>Повторить</Button></div> : loading ? efficiency
    ? <div role="status" aria-label="Загрузка данных" aria-busy="true"><div className="home-efficiency" aria-hidden="true"><SkeletonBlock width="104px" height="104px" circle /><div><SkeletonBlock width="100px" height="24px" /><SkeletonBlock width="80%" /><SkeletonBlock width="65%" /></div></div><SkeletonBlock height="110px" /></div>
    : <HomeRowsSkeleton rows={3} /> : null;
}
function HomeRowsSkeleton({ rows, label }: { readonly rows: number; readonly label?: string }) {
  return <LoadingSkeleton layout="custom" label={label}><ul className="home-list">{Array.from({ length: rows }, (_, index) => <li key={index}><div className="home-row"><span className="home-row-copy ws-skeleton-copy"><SkeletonBlock width="78%" /><SkeletonBlock width="55%" height="12px" /></span><SkeletonBlock width="20px" height="20px" /></div></li>)}</ul></LoadingSkeleton>;
}
function Panel({ id, title, icon, note, action, children }: { readonly id: string; readonly title: string; readonly icon: ReactNode; readonly note: ReactNode; readonly action?: ReactNode; readonly children: ReactNode }) {
  return <section className="home-panel" aria-labelledby={"home-" + id} data-home-panel={id}>
    <header className="home-panel-heading"><span className="home-panel-icon" aria-hidden="true">{icon}</span><div><h3 id={"home-" + id}>{title}</h3><p>{note}</p></div>{action}</header>
    {children}
  </section>;
}
function Empty({ children }: { readonly children: ReactNode }) { return <p className="home-empty">{children}</p>; }
function Row({ title, note, onClick, leading, trailing, tone = "brand" }: { readonly title: string; readonly note: ReactNode; readonly onClick: () => void; readonly leading?: ReactNode; readonly trailing?: ReactNode; readonly tone?: string }) {
  return <li><button type="button" className="home-row" data-tone={tone} onClick={onClick}>{leading}<span className="home-row-copy"><strong>{title}</strong><small>{note}</small></span>{trailing ?? <ArrowRight20Regular aria-hidden="true" />}</button></li>;
}
function SignalNote({ note }: { readonly note: string }) {
  const separator = note.indexOf(" · ");
  return separator < 0 ? <>{note}</> : <>{note.slice(0, separator + 2)} {note.slice(separator + 3)}</>;
}

export function PersonalHomeView({ token, workspace, canView, zoomMeetings = [], zoomError, zoomLoading = false, onOpen, onOpenNotification, onRefresh }: Props) {
  const user = workspace.currentUser;
  // Credential renewal reloads the same employee's resources without clearing
  // already visible cards. The loader cleanup still fences late token requests.
  const identity = user.id;
  const [now, setNow] = useState(Date.now);
  const [revision, setRevision] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const openProfile = useOpenEmployeeProfile();
  const period = homePeriod(now);
  const efficiencyLoader = useCallback(() => loadPersonalEfficiency(token, period), [token, period]);
  const recognitionLoader = useCallback(() => loadEmployeeRecognitionProfile(token, user.id), [token, user.id]);
  const reactionLoader = useCallback(() => loadPersonalReactions(token), [token]);
  const referentLoader = useCallback(() => loadAIReferentIncomingRegistry(token), [token]);
  const edoLoader = useCallback(() => loadEdoIncomingLetters(token, { personal: true }), [token]);
  const projectLoader = useCallback(() => loadProjectHub(token), [token]);
  const efficiency = useResource(identity + ":" + period, true, efficiencyLoader, revision);
  const recognition = useResource(identity, true, recognitionLoader, revision);
  const reactions = useResource(identity, canView("messenger"), reactionLoader, revision);
  const referent = useResource(identity, canView("ai_referent"), referentLoader, revision);
  const edo = useResource(identity, canView("incoming_letters"), edoLoader, revision);
  const projects = useResource(identity, canView("project_hub"), projectLoader, revision);
  const projectsLoading = canView("project_hub") && !projects;
  const data = buildPersonalHome(workspace, canView, now, zoomMeetings, projects?.data?.projects);
  const [order, setOrder] = useState(() => rankHomePanels(data, now));
  const [layoutRevision, setLayoutRevision] = useState(0);
  const recommendedOrder = rankHomePanels(data, now);
  const orderChanged = order.join() !== recommendedOrder.join();
  const motionRef = useContextMotion(String(layoutRevision), { enter: true, rows: ":scope > .home-panel-slot" });
  const retry = () => setRevision(value => value + 1);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") { setNow(Date.now()); setRevision(value => value + 1); }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true); setRefreshError(undefined);
    try { await onRefresh(); setNow(Date.now()); retry(); }
    catch (error) { setRefreshError(error instanceof Error ? error.message : "Не удалось обновить Главную"); }
    finally { setRefreshing(false); }
  };
  const allLink = (section: NavigationKey, label: string) => <Button size="small" appearance="subtle" aria-label={label} icon={<ArrowRight20Regular />} onClick={() => onOpen({ section })} />;
  const myReferent = referent?.data?.letters.filter(l => l.responsibleUserId === user.id).sort((a, b) => timestamp(b.receivedAt) - timestamp(a.receivedAt)) ?? [];
  // personal=true is applied by the server before pagination. Compact EDO
  // list rows omit assignments, so filtering them again would hide real mail.
  // Never present a broader or unconfirmed scope as personal correspondence.
  const personalEdo = edo?.data?.visibility === "assigned" ? edo.data : undefined;
  const myEdo = personalEdo?.data ?? [];
  const edoError = edo?.error ?? (edo?.data && !personalEdo
    ? "Не удалось подтвердить личную область писем. Обновите данные или обратитесь к администратору."
    : undefined);
  const mailLoading = (canView("ai_referent") && !referent)
    || (canView("incoming_letters") && !edo);
  const canViewMail = canView("ai_referent") || canView("incoming_letters");
  const unread = data.notifications.filter(n => !n.readAt).length;
  const important = data.notifications.filter(n => n.requiresAction && !n.resolvedAt).length;
  const next = data.signals[0];
  const panels: Record<HomePanelKey, ReactNode> = {
    attention: <Panel id="attention" title="Мой фокус" note="Сначала риски, затем ближайшие действия" icon={<TaskListSquareLtr24Regular />} action={canView("tasks") ? allLink("tasks", "Открыть все задачи") : undefined}>
      {projects?.error ? <WorkspaceNotice tone="warning" className="home-notice" role="status" actions={<><button type="button" onClick={retry}>Повторить</button></>}>Сроки проектов не загружены. </WorkspaceNotice> : null}
      {data.signals.length ? <ul className="home-list">{data.signals.slice(0, 5).map(s => <Row key={s.id} title={s.title} note={<SignalNote note={s.note} />} tone={s.tone} onClick={() => onOpen(s)} />)}</ul> : !projectsLoading ? <Empty>Срочных действий нет. Можно спокойно продолжить текущую работу.</Empty> : null}
      {projectsLoading ? <HomeRowsSkeleton rows={1} label="Загрузка сроков проектов" /> : null}
      {canView("tasks") ? <div className="home-workload" aria-label="Текущие личные задачи">{[["Новые", "new"], ["В работе", "in_progress"], ["На проверке", "awaiting_review"]].map(([label, status]) => <div key={status}><strong>{data.tasks.filter(t => t.status === status || (status === "in_progress" && t.status === "overdue")).length}</strong><span>{label}</span></div>)}</div> : null}
    </Panel>,
    notifications: canView("notifications") ? <Panel id="notifications" title="Важные уведомления" note={important ? <>{important} требуют вашего решения</> : "Последние обновления вашей очереди"} icon={<Mail24Regular />} action={allLink("notifications", "Открыть центр уведомлений")}>
      {data.notifications.length ? <ul className="home-list">{data.notifications.slice(0, 4).map(n => <Row key={n.id} title={n.title} note={n.body} tone={n.priority === "urgent" ? "danger" : n.priority === "attention" ? "warning" : "brand"} onClick={() => onOpenNotification(n)} trailing={<span className="home-time">{homeDate.format(timestamp(n.occurredAt))}{!n.readAt ? <i aria-label="Не прочитано" /> : null}</span>} />)}</ul> : <Empty>Важных уведомлений пока нет.</Empty>}
    </Panel> : null,
    messages: canView("messenger") ? <Panel id="messages" title="Мини-мессенджер" note="Последние сообщения ваших активных чатов" icon={<Chat24Regular />} action={allLink("messenger", "Открыть мессенджер")}>
      {data.chats.length ? <ul className="home-list">{data.chats.slice(0, 4).map(({ chat, message }) => {
        const author = workspace.people.find(p => p.id === message?.authorId);
        return <Row key={chat.id} title={chat.title} note={(message?.authorId === user.id ? "Вы: " : author ? author.name + ": " : "") + (message?.body || chat.preview || "Вложение")}
          leading={author ? <ProfileAvatar person={author} token={token} size={32} /> : <Chat24Regular aria-hidden="true" />}
          trailing={<span className="home-time">{message?.time || chat.time}{chat.unread > 0 ? <b aria-label={chat.unread + " непрочитанных"}>{chat.unread}</b> : null}</span>}
          onClick={() => onOpen({ section: "messenger", entityId: chat.id, messageId: message?.id })} />;
      })}</ul> : <Empty>Сообщения появятся здесь, когда начнётся переписка.</Empty>}
    </Panel> : null,
    schedule: canView("calendar") || canView("zoom_meetings") ? <Panel id="schedule" title="Ближайшие встречи" note="Ваш календарь и приглашения в Zoom" icon={<CalendarLtr24Regular />} action={canView("calendar") ? allLink("calendar", "Открыть календарь") : undefined}>
      {data.schedule.length ? <ul className="home-list">{data.schedule.slice(0, 4).map(e => <Row key={e.section + e.id} title={e.title} note={homeDate.format(timestamp(e.startsAt)) + " · " + e.note} onClick={() => onOpen({ section: e.section, entityId: e.id })} />)}</ul> : !zoomLoading ? <Empty>Ближайших встреч в вашем расписании нет.</Empty> : null}
      {zoomLoading ? <HomeRowsSkeleton rows={2} label="Загрузка встреч" /> : null}
      {zoomError && canView("zoom_meetings") ? <WorkspaceNotice tone="warning" className="home-notice" role="status" actions={<><button type="button" onClick={() => onOpen({ section: "zoom_meetings" })}>Открыть конференции</button></>}>Расписание Zoom не загружено. </WorkspaceNotice> : null}
    </Panel> : null,
    efficiency: <Panel id="efficiency" title="Моя эффективность" note="Выполнение задач в срок · текущий месяц" icon={<TaskListSquareLtr24Regular />}>
      <ResourceState loading={!efficiency} error={efficiency?.error} onRetry={retry} efficiency />
      {efficiency?.data && efficiency.data.employee.userId === user.id ? <><div className="home-efficiency"><ScoreGauge employee={efficiency.data.employee} /><div><strong>{efficiency.data.employee.onTimeCount} из {efficiency.data.employee.eligibleCount}</strong><p>учтённых задач сданы вовремя</p><small>Это соблюдение сроков, не оценка человека.</small>{efficiency.data.employee.smallSample ? <WorkspaceNotice tone="warning" className="home-notice">Малая выборка</WorkspaceNotice> : null}{efficiency.data.employee.historyCompleteness !== "complete" ? <WorkspaceNotice tone="warning" className="home-notice">История месяца неполная</WorkspaceNotice> : null}</div></div><HistoryChart employee={efficiency.data.employee} /></> : null}
    </Panel>,
    department: <Panel id="department" title="Мой отдел" note={data.department?.name ?? "Подразделение пока не назначено"} icon={<PeopleTeam24Regular />}>
      {data.department ? <><div className="home-department-count"><strong>{Math.max(0, data.department.assignedUsersCount - 1)}</strong><span>других сотрудников в отделе</span>{data.department.chatId && canView("messenger") ? <Button size="small" onClick={() => onOpen({ section: "messenger", entityId: data.department?.chatId ?? undefined })}>Чат отдела</Button> : null}</div><ul className="home-colleagues">{data.colleagues.slice(0, 6).map(p => <li key={p.id}><EmployeeProfileLink userId={p.id} personName={p.name}><ProfileAvatar person={p} token={token} size={36} /><span><strong>{p.name}</strong><small>{p.jobTitle || "Сотрудник"}</small></span></EmployeeProfileLink></li>)}</ul>{data.colleagues.length > 6 ? <details className="home-more-colleagues"><summary>Ещё {data.colleagues.length - 6} сотрудников отдела</summary><ul className="home-colleagues">{data.colleagues.slice(6).map(p => <li key={p.id}><EmployeeProfileLink userId={p.id} personName={p.name}><ProfileAvatar person={p} token={token} size={36} /><span><strong>{p.name}</strong><small>{p.jobTitle || "Сотрудник"}</small></span></EmployeeProfileLink></li>)}</ul></details> : null}</> : <Empty>Администратор назначает отдел в разделе «Отделы и подразделения».</Empty>}
    </Panel>,
    mail: <Panel id="mail" title="Мои письма" note="Письма, назначенные лично вам" icon={<Mail24Regular />}
      action={canView("incoming_letters") ? allLink("incoming_letters", "Открыть входящие письма") : undefined}>
      {myReferent.length || myEdo.length ? <ul className="home-list">
        {myReferent.slice(0, 3).map(l => <Row key={"ref:" + l.id} title={l.subject || "Входящее письмо"}
          note={["ИИ-референт", l.platformIncomingNumber, l.senderOrganization].filter(Boolean).join(" · ")}
          onClick={() => onOpen({ section: "ai_referent", entityId: l.id, incomingReferent: true })} />)}
        {myEdo.slice(0, 3).map(l => <Row key={"edo:" + l.id}
          title={l.description || "Письмо №" + (l.in_num || l.id)}
          note={["ЭДО", "№" + (l.in_num || l.id), l.organization,
            l.status === null ? "Не просмотрено" : l.status === 1 ? "В работе"
              : l.status === 2 ? "Выполнено исполнителем" : "Подтверждено",
            personalEdo?.deadline_timezone_verified && l.overdue === true ? "Просрочено" : null,
          ].filter(Boolean).join(" · ")}
          tone={personalEdo?.deadline_timezone_verified && l.overdue === true ? "danger" : "brand"}
          onClick={() => onOpen({ section: "incoming_letters", entityId: String(l.id) })} />)}
      </ul> : !canViewMail ? <Empty>Модуль писем недоступен по вашим правам.</Empty>
        : !mailLoading && !referent?.error && !edoError
          ? <Empty>В последних доступных письмах нет назначенных вам.</Empty> : null}
      <ResourceState loading={mailLoading} onRetry={retry} />
      {referent?.error ? <ResourceState loading={false} error={referent.error} onRetry={retry} /> : null}
      {edoError ? <ResourceState loading={false} error={edoError} onRetry={retry} /> : null}
      {personalEdo ? <WorkspaceNotice tone="warning" className="home-notice">Писем, назначенных вам в ЭДО: {personalEdo.meta.total}.
        {personalEdo.meta.total > myEdo.slice(0, 3).length ? " Здесь показаны до трёх последних писем; полный список — во «Входящих письмах»." : null}</WorkspaceNotice> : null}
    </Panel>,
    recognition: <Panel id="recognition" title="Награды и достижения" note="Признание коллег и подтверждённые результаты" icon={<Reward24Regular />} action={openProfile ? <Button size="small" appearance="subtle" onClick={() => openProfile(user.id)}>Мой профиль</Button> : undefined}>
      <ResourceState loading={!recognition} error={recognition?.error} onRetry={retry} />
      {recognition?.data?.person.id === user.id ? <><ul className="home-recognition">{[...recognition.data.rewards].filter(r => r.recipientUserId === user.id).sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt)).slice(0, 3).map(r => <li key={r.id}><RecognitionBadgeArtwork iconKey={r.iconKey} /><div><strong>{r.title}</strong><EmployeeProfileLink userId={r.issuerUserId} personName={r.issuerName}>От {r.issuerName}</EmployeeProfileLink><small>{r.contextNote || homeDate.format(timestamp(r.createdAt))}</small></div></li>)}</ul><ul className="home-recognition">{recognition.data.achievements.filter(a => a.unlocked).sort((a, b) => timestamp(b.earnedAt) - timestamp(a.earnedAt)).slice(0, 3).map(a => <li key={a.code}><RecognitionBadgeArtwork iconKey={a.iconKey} /><div><strong>{a.title}</strong><small>{a.description}</small></div></li>)}</ul>{!recognition.data.rewards.length && !recognition.data.achievements.some(a => a.unlocked) ? <Empty>Ваши первые награды и достижения появятся здесь.</Empty> : null}</> : null}
    </Panel>,
    feed: canView("feed") ? <Panel id="feed" title="События из ленты" note="Новости, которые стоит прочитать" icon={<Mail24Regular />} action={allLink("feed", "Открыть ленту")}>
      {data.feed.length ? <ul className="home-list">{data.feed.slice(0, 3).map(p => <Row key={p.id} title={p.title} note={(p.isPinned ? "Закреплено · " : "") + p.body} onClick={() => onOpen({ section: "feed", entityId: p.id })} />)}</ul> : <Empty>Новых событий в ленте пока нет.</Empty>}
    </Panel> : null,
    reactions: canView("messenger") ? <Panel id="reactions" title="Отклик на мои сообщения" note="Реакции коллег в доступных вам чатах · за всё время" icon={<Chat24Regular />}>
      <ResourceState loading={!reactions} error={reactions?.error} onRetry={retry} />
      {reactions?.data ? <><div className="home-reaction-total"><strong>{reactions.data.totalCount}</strong><span>полученных реакций</span></div>{reactions.data.reactions.length ? <ul className="home-reactions">{reactions.data.reactions.slice(0, 5).map(r => <li key={r.emoji}><span aria-label={r.emoji}><ReactionEmoji emoji={r.emoji} /></span><strong>{r.count}</strong></li>)}</ul> : <Empty>Когда коллеги отреагируют на ваши сообщения, здесь появится сводка.</Empty>}</> : null}
    </Panel> : null,
  };
  return <div className="workspace-view personal-home" aria-label="Персональная Главная">
    <WorkspaceSectionHeader motif="team" className="home-hero"><div><span>Главная · ваше рабочее пространство</span><h2>Добрый день, {personalGreetingName(user.name)}</h2><p>{next ? <>В фокусе: {next.title}</> : "Всё важное — рядом. Спокойный день начинается с ясного плана."}</p></div><Button icon={<ArrowSync20Regular />} disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Обновляем…" : "Обновить"}</Button></WorkspaceSectionHeader>
    <div className="home-ready-content">
    {refreshError ? <WorkspaceNotice tone="warning" className="home-notice" role="alert">{refreshError}</WorkspaceNotice> : null}
    <div className="home-overview" aria-label="Мой день"><article><strong>{projectsLoading ? <SkeletonBlock width="32px" height="28px" /> : data.signals.length + important}</strong><span>сигналов внимания</span></article><article><strong>{canView("tasks") ? data.tasks.length : "—"}</strong><span>моих активных задач</span></article><article><strong>{canView("messenger") ? data.chats.reduce((sum, c) => sum + c.chat.unread, 0) : "—"}</strong><span>непрочитанных сообщений</span></article><article><strong>{unread}</strong><span>новых уведомлений</span></article></div>
    {orderChanged ? <div className="home-priority-update" role="status"><span>Приоритеты изменились. Обновить порядок блоков?</span><Button size="small" onClick={() => { setOrder(recommendedOrder); setLayoutRevision(value => value + 1); }}>Обновить фокус дня</Button></div> : null}
    <div className="home-grid" ref={motionRef}>{order.map(key => panels[key] ? <div key={key} className="home-panel-slot">{panels[key]}</div> : null)}</div>
    </div>
  </div>;
}
