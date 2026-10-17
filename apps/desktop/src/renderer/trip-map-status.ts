import type { TripRequest } from "@yuksalish/contracts";

export type TripMapStatus = "upcoming" | "current" | "past";

const tashkentDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
});

export function tripMapToday(now: Date): string {
  const parts = Object.fromEntries(tashkentDate.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function tripMapStatus(request: Pick<TripRequest, "startDate" | "endDate">, today: string): TripMapStatus {
  if (request.startDate > today) return "upcoming";
  if (request.endDate < today) return "past";
  return "current";
}

export function tripMapLocationStatus(requests: readonly Pick<TripRequest, "startDate" | "endDate">[], today: string): TripMapStatus {
  if (requests.some((request) => tripMapStatus(request, today) === "current")) return "current";
  if (requests.some((request) => tripMapStatus(request, today) === "upcoming")) return "upcoming";
  return "past";
}

export const tripMapStatusLabels: Readonly<Record<TripMapStatus, string>> = {
  upcoming: "Предстоит",
  current: "Идёт сейчас",
  past: "Даты прошли",
};
