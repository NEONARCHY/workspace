import { lazy } from "react";
import type { NavigationKey } from "@yuksalish/contracts";
import { isProfilePreloadSession, loadPreparedProfile, loadPreparedProfileEfficiency } from "./profile-preload";

/* Split secondary views from the login/messenger shell. The same imports are
   reused by React.lazy and the post-render idle warmer, so a click during
   warm-up never downloads a chunk twice. */
const tasks = () => import("./TasksView");
const team = () => import("./TeamDashboardView");
const approvals = () => import("./ApprovalsView");
const referent = () => import("./AIReferentView");
const incomingLetters = () => import("./IncomingLettersView");
const hisobot = () => import("./AIHisobotView");
const telegram = () => import("./TelegramAccessView");
const feed = () => import("./FeedView");
const projects = () => import("./ProjectsView");
const projectHub = () => import("./ProjectHubView");
const trips = () => import("./TripApprovalsView");
const calendar = () => import("./CalendarView");
const zoom = () => import("./ZoomView");
const absences = () => import("./AbsencesView");
const members = () => import("./MembersView");
const hr = () => import("./HrView");
const employees = () => import("./EmployeesView");
const account = () => import("./AccountPanel");
const profile = () => import("./EmployeeProfileDialog");
const support = () => import("./SupportDialog");

export const TasksView = lazy(() => tasks().then((module) => ({ default: module.TasksView })));
export const TeamDashboardView = lazy(() => team().then((module) => ({ default: module.TeamDashboardView })));
export const ApprovalsView = lazy(() => approvals().then((module) => ({ default: module.ApprovalsView })));
export const AIReferentView = lazy(() => referent().then((module) => ({ default: module.AIReferentView })));
export const IncomingLettersView = lazy(() => incomingLetters().then((module) => ({ default: module.IncomingLettersView })));
export const AIHisobotView = lazy(() => hisobot().then((module) => ({ default: module.AIHisobotView })));
export const TelegramAccessView = lazy(() => telegram().then((module) => ({ default: module.TelegramAccessView })));
export const FeedView = lazy(() => feed().then((module) => ({ default: module.FeedView })));
export const ProjectsView = lazy(() => projects().then((module) => ({ default: module.ProjectsView })));
export const ProjectHubView = lazy(() => projectHub().then((module) => ({ default: module.ProjectHubView })));
export const TripApprovalsView = lazy(() => trips().then((module) => ({ default: module.TripApprovalsView })));
export const CalendarView = lazy(() => calendar().then((module) => ({ default: module.CalendarView })));
export const ZoomView = lazy(() => zoom().then((module) => ({ default: module.ZoomView })));
export const AbsencesView = lazy(() => absences().then((module) => ({ default: module.AbsencesView })));
export const MembersView = lazy(() => members().then((module) => ({ default: module.MembersView })));
export const HrView = lazy(() => hr().then((module) => ({ default: module.HrView })));
export const EmployeesView = lazy(() => employees().then((module) => ({ default: module.EmployeesView })));
export const AccountPanel = lazy(() => account().then((module) => ({ default: module.AccountPanel })));
export const EmployeeProfileDialog = lazy(() => profile().then((module) => ({ default: module.EmployeeProfileDialog })));
export const SupportDialog = lazy(() => support().then((module) => ({ default: module.SupportDialog })));

const sectionLoaders: readonly [NavigationKey, () => Promise<unknown>][] = [
  ["tasks", tasks], ["team_overview", team], ["payment_requests", approvals],
  ["ai_referent", referent], ["incoming_letters", incomingLetters], ["ai_hisobot", hisobot], ["telegram_access", telegram],
  ["feed", feed], ["projects", projects], ["project_hub", projectHub],
  ["project_funding", projectHub], ["trip_approvals", trips], ["calendar", calendar],
  ["zoom_meetings", zoom], ["absences", absences], ["members", members],
  ["hr", hr], ["employees", employees],
];

export async function prepareEmployeeProfile(token: string, userId: string): Promise<() => void> {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData || document.visibilityState === "hidden") return () => undefined;
  const [artwork, data] = await Promise.all([
    import("./RecognitionBadgeArtwork"), loadPreparedProfile(token, userId), profile(),
    loadPreparedProfileEfficiency(token).catch(() => undefined),
  ]);
  if (!isProfilePreloadSession(token)) return () => undefined;
  return artwork.prewarmRecognitionArtwork([
    ...data.achievements.filter((item) => item.unlocked).slice(-4).map((item) => item.iconKey),
    ...data.rewards.map((item) => item.iconKey), ...data.achievements.map((item) => item.iconKey),
  ]);
}

export function preloadWorkspaceModules(allowed: ReadonlySet<string>, warmProfile?: () => Promise<unknown>): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  const loaders = [warmProfile ?? profile, account,
    ...new Set(sectionLoaders.filter(([key]) => allowed.has(key)).map(([, load]) => load)), support];
  let stopped = false;
  let index = 0;
  let idleId: number | undefined;
  let timerId: number | undefined;
  const schedule = () => {
    if (stopped || index >= loaders.length || document.visibilityState === "hidden") return;
    const run = () => {
      if (stopped) return;
      const batch = loaders.slice(index, index + 2);
      index += batch.length;
      void Promise.all(batch.map((load) => load().catch(() => undefined)))
        .then(() => { timerId = window.setTimeout(schedule, 120); });
    };
    if (window.requestIdleCallback) idleId = window.requestIdleCallback(run, { timeout: 2500 });
    else timerId = window.setTimeout(run, 250);
  };
  const resume = () => { if (document.visibilityState === "visible") schedule(); };
  document.addEventListener("visibilitychange", resume);
  schedule();
  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", resume);
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
    if (timerId !== undefined) window.clearTimeout(timerId);
  };
}
