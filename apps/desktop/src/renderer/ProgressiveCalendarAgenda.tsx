import type { ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { useProgressiveList } from "./useProgressiveList";

const CALENDAR_BATCH_SIZE = 10;

/** One scroll rail for both inline and mobile agendas; unmount releases its window. */
export function ProgressiveCalendarAgenda({ total, resetKey, children, disabled = false }: {
  readonly total: number;
  readonly resetKey: string;
  readonly children: (shown: number) => ReactNode;
  readonly disabled?: boolean;
}) {
  const { stream, sentinel, shown, hasMore, loadMore } = useProgressiveList(total, resetKey, ".calendar-agenda-card", CALENDAR_BATCH_SIZE);
  return <div className="calendar-agenda-stream" ref={stream} role="region" aria-label="Список выбранного дня" tabIndex={0}>
    {children(shown)}
    {hasMore ? <div className="calendar-agenda-load-more" ref={sentinel}>
      <span aria-live="polite">Показано {shown} из {total}</span>
      <Button disabled={disabled} onClick={() => loadMore(true)}>Показать ещё {Math.min(CALENDAR_BATCH_SIZE, total - shown)}</Button>
    </div> : null}
  </div>;
}
