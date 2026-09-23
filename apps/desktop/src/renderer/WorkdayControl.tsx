import { useEffect, useState } from "react";

import type { WorkdayMe } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { Clock20Regular, Play20Regular, Stop20Regular } from "@fluentui/react-icons";

import { finishMyWorkday, loadMyWorkday, startMyWorkday } from "./workspace-api";

function timeLabel(value: string): string {
  return value.slice(0, 5);
}

export function WorkdayControl({ token }: { readonly token: string }) {
  const [data, setData] = useState<WorkdayMe>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadMyWorkday(token).then((result) => {
        if (!result.schedule?.startsAt || !result.schedule?.endsAt) {
          throw new Error("Сервер вернул неполный рабочий статус");
        }
        if (active) { setData(result); setError(""); }
      }).catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Не удалось получить рабочий статус");
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token]);

  const act = async () => {
    if (busy || !data || data.status === "approved_absence") return;
    setBusy(true);
    setError("");
    try {
      const result = data.status === "working"
        ? await finishMyWorkday(token)
        : await startMyWorkday(token);
      if (!result.schedule?.startsAt || !result.schedule?.endsAt) {
        throw new Error("Сервер вернул неполный рабочий статус");
      }
      setData(result);
      window.dispatchEvent(new Event("yuksalish:workday-changed"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось изменить рабочий статус");
    } finally {
      setBusy(false);
    }
  };

  const isWorking = data?.status === "working";
  const label = isWorking ? "Завершить работу" : data?.status === "finished" ? "Начать снова" : "Начать работу";
  const schedule = data
    ? `График ${timeLabel(data.schedule.startsAt)}–${timeLabel(data.schedule.endsAt)}`
    : "Рабочий статус";
  return <div className="workday-control">
    {data?.status === "approved_absence" ? (
      <span className="workday-control-away" title={schedule}><Clock20Regular /> Отсутствие оформлено</span>
    ) : <Button
      appearance={isWorking ? "secondary" : "primary"}
      icon={isWorking ? <Stop20Regular /> : <Play20Regular />}
      disabled={busy || !data}
      title={`${label} · ${schedule}${data?.session?.closeSource === "automatic" ? " · предыдущий день закрыт автоматически" : ""}`}
      onClick={() => void act()}
    >{busy ? "Сохраняем…" : data ? label : "Рабочий день"}</Button>}
    {error ? <button className="workday-control-error" type="button" role="alert" title={error} onClick={() => {
      void loadMyWorkday(token).then((result) => {
        if (!result.schedule?.startsAt || !result.schedule?.endsAt) {
          throw new Error("Сервер вернул неполный рабочий статус");
        }
        setData(result); setError("");
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "Повторите позже"));
    }}>Ошибка · повторить</button> : null}
  </div>;
}
