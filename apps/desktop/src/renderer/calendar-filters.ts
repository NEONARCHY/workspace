import type { CalendarEvent, ZoomMeeting } from "@yuksalish/contracts";

export interface CalendarFilters {
  readonly employeeId: string;
  readonly query: string;
  readonly from: string;
  readonly to: string;
  readonly showCancelled: boolean;
}
export const emptyCalendarFilters: CalendarFilters = { employeeId: "", query: "", from: "", to: "", showCancelled: true };
export type CalendarScheduleItem =
  | { readonly kind: "event"; readonly key: string; readonly title: string; readonly record: CalendarEvent }
  | { readonly kind: "zoom"; readonly key: string; readonly title: string; readonly record: ZoomMeeting };

export function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateStart(key: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
  const date = new Date(`${key}T00:00:00`);
  return Number.isFinite(date.getTime()) && calendarDateKey(date) === key ? date : undefined;
}
export function calendarRangeError(from: string, to: string): string {
  if ((from && !dateStart(from)) || (to && !dateStart(to))) return "Укажите корректные даты периода.";
  return from && to && from > to ? "Дата окончания должна быть не раньше даты начала." : "";
}
export function calendarDayInRange(key: string, filters: Pick<CalendarFilters, "from" | "to">): boolean {
  return (!filters.from || key >= filters.from) && (!filters.to || key <= filters.to);
}
function overlapsDates(start: number, end: number, from: string, to: string): boolean {
  if (calendarRangeError(from, to)) return false;
  const first = dateStart(from);
  const last = dateStart(to);
  if (last) last.setDate(last.getDate() + 1);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    && (!first || end > first.getTime()) && (!last || start < last.getTime());
}
/** Filter only the records already authorised by the server; never fetch another person's calendar. */
export function filterCalendarSchedule(events: readonly CalendarEvent[], zoom: readonly ZoomMeeting[], filters: CalendarFilters): CalendarScheduleItem[] {
  const items: CalendarScheduleItem[] = [
    ...events.filter(event => event.eventType === "meeting" || event.eventType === "general")
      .map(record => ({ kind: "event" as const, key: `event:${record.id}`, title: record.title, record })),
    ...zoom.filter(record => record.status === "scheduled")
      .map(record => ({ kind: "zoom" as const, key: `zoom:${record.id}`, title: record.topic, record })),
  ];
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter(item => {
    const record = item.record;
    const attendees = item.kind === "event" ? item.record.attendeeIds : item.record.participantIds;
    if (filters.employeeId && record.organizerUserId !== filters.employeeId && !attendees.includes(filters.employeeId)) return false;
    if (!filters.showCancelled && record.status === "cancelled") return false;
    const text = `${item.title} ${record.description} ${item.kind === "event" ? item.record.location : "Zoom"}`.toLocaleLowerCase();
    return (!query || text.includes(query)) && overlapsDates(Date.parse(record.startsAt), Date.parse(record.endsAt), filters.from, filters.to);
  }).sort((left, right) => Date.parse(left.record.startsAt) - Date.parse(right.record.startsAt) || left.key.localeCompare(right.key));
}
export function calendarItemsOnDay(items: readonly CalendarScheduleItem[], date: Date, filters: Pick<CalendarFilters, "from" | "to">): CalendarScheduleItem[] {
  const key = calendarDateKey(date);
  if (!calendarDayInRange(key, filters)) return [];
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return items.filter(item => Date.parse(item.record.startsAt) < end.getTime() && Date.parse(item.record.endsAt) > start.getTime());
}
export function calendarScheduleGroups(items: readonly CalendarScheduleItem[], periodStart = ""): { day: string; items: CalendarScheduleItem[] }[] {
  const groups = new Map<string, CalendarScheduleItem[]>();
  for (const item of items) {
    const actualDay = calendarDateKey(new Date(item.record.startsAt));
    const day = periodStart && actualDay < periodStart ? periodStart : actualDay;
    const group = groups.get(day);
    if (group) group.push(item);
    else groups.set(day, [item]);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([day, records]) => ({ day, items: records }));
}
