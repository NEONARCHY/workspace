import { useEffect, useState } from "react";

import type { CalendarEvent } from "@yuksalish/contracts";

export function useCalendarEventClock(events: readonly CalendarEvent[]): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const nextEnd = events.reduce((earliest, event) => {
      const endsAt = Date.parse(event.endsAt);
      return endsAt > now && endsAt < earliest ? endsAt : earliest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextEnd)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(nextEnd - now + 1, 1), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [events, now]);

  return now;
}
