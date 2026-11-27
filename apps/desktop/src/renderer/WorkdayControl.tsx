import { useEffect, useRef, useState } from "react";

import type { WorkdayMe } from "@yuksalish/contracts";
import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Clock20Regular, Play20Regular, Stop20Regular } from "@fluentui/react-icons";

import { finishMyWorkday, loadMyWorkday, startMyWorkday } from "./workspace-api";
import { startVisiblePolling } from "./visible-polling";

function timeLabel(value: string): string {
  return value.slice(0, 5);
}
function checkedWorkday(result: WorkdayMe): WorkdayMe {
  if (!result.schedule?.startsAt || !result.schedule?.endsAt) throw new Error("Сервер вернул неполный рабочий статус");
  return result;
}

export function WorkdayControl({ token }: { readonly token: string }) {
  return <WorkdaySessionControl key={token} token={token} />;
}

function WorkdaySessionControl({ token }: { readonly token: string }) {
  const [data, setData] = useState<WorkdayMe>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const busyRef = useRef(false);
  const epoch = useRef(0);
  const reader = useRef<ReturnType<typeof startVisiblePolling> | undefined>(undefined);

  useEffect(() => {
    epoch.current += 1;
    const poll = startVisiblePolling(signal => loadMyWorkday(token, signal).then(checkedWorkday), result => { setData(result); setError(""); },
      failure => setError(failure instanceof Error ? failure.message : "Не удалось получить рабочий статус"), 60_000, () => busyRef.current);
    reader.current = poll;
    return () => {
      epoch.current += 1; reader.current = undefined; poll();
    };
  }, [token]);

  const act = async () => {
    if (busyRef.current || !data || data.status === "approved_absence") return;
    const requestEpoch = epoch.current;
    busyRef.current = true;
    reader.current?.invalidate();
    setBusy(true);
    setError("");
    try {
      const result = data.status === "working"
        ? await finishMyWorkday(token)
        : await startMyWorkday(token);
      checkedWorkday(result);
      if (epoch.current !== requestEpoch) return;
      setData(result);
      setPopoverOpen(false);
      window.dispatchEvent(new Event("yuksalish:workday-changed"));
    } catch (failure) {
      if (epoch.current === requestEpoch) setError(failure instanceof Error ? failure.message : "Не удалось изменить рабочий статус");
    } finally {
      if (epoch.current === requestEpoch) { busyRef.current = false; setBusy(false); }
    }
  };

  const isWorking = data?.status === "working";
  const label = isWorking ? "Завершить работу" : data?.status === "finished" ? "Начать снова" : "Начать работу";
  const schedule = data
    ? `График ${timeLabel(data.schedule.startsAt)}–${timeLabel(data.schedule.endsAt)}`
    : "Рабочий статус";
  const status = !data ? "Загружаем статус" : isWorking ? "Сейчас в работе" : data.status === "approved_absence" ? "Отсутствие оформлено" : data.status === "finished" ? "Работа завершена" : "Работа не начата";
  const action = data?.status === "approved_absence" ? (
      <span className="workday-control-away" title={schedule}><Clock20Regular /> Отсутствие оформлено</span>
    ) : <Button
      className="workday-action" data-action={isWorking ? "finish" : "start"} data-satin-excluded
      appearance={isWorking ? "secondary" : "primary"}
      icon={isWorking ? <Stop20Regular /> : <Play20Regular />}
      disabled={!data}
      disabledFocusable={busy}
      aria-busy={busy}
      aria-label={busy ? "Сохраняем…" : data ? label : "Рабочий день"}
      title={`${label} · ${schedule}${data?.session?.closeSource === "automatic" ? " · предыдущий день закрыт автоматически" : ""}`}
      onClick={() => void act()}
    ><span className="workday-action-glint" aria-hidden="true" /><span className="workday-action-impact" aria-hidden="true" /><span className="workday-control-label">{busy ? "Сохраняем…" : data ? label : "Рабочий день"}</span><span className="workday-control-mobile-label" aria-hidden="true">{busy ? "Сохраняем…" : !data ? "Рабочий день" : isWorking ? "Завершить" : data.status === "finished" ? "Снова" : "Начать"}</span></Button>;
  const feedback = error ? <button className="workday-control-error" type="button" role="alert" title={error} onClick={() => {
      reader.current?.refresh();
    }}>Ошибка · повторить</button> : null;
  return <div className="workday-control">
    <div className="workday-control-direct">{action}{feedback}</div>
    <Popover open={popoverOpen} onOpenChange={(_, next) => setPopoverOpen(next.open)} positioning="below-end" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <button type="button" className="workday-control-mobile-trigger" aria-label={`Рабочий день: ${status}`} title={`${data?.status === "approved_absence" ? status : label} · ${schedule}`}
          data-action={!data ? "loading" : data.status === "approved_absence" ? "away" : isWorking ? "finish" : "start"} data-working={isWorking || undefined} data-error={Boolean(error) || undefined}>
          <span className="workday-control-glyph" aria-hidden="true">{!data || data.status === "approved_absence" ? <Clock20Regular /> : isWorking ? <Stop20Regular /> : <Play20Regular />}</span><i aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverSurface className="workday-control-popover" aria-label="Рабочий день">
        <h2>Рабочий день</h2><strong>{status}</strong><p>{schedule}</p>
        <div className="workday-control-popover-actions">{action}{feedback}</div>
      </PopoverSurface>
    </Popover>
  </div>;
}
