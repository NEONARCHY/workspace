import { Button } from "@fluentui/react-components";

import { CompanyLogo } from "./CompanyLogo";
import type { DesktopUpdateStatus } from "./desktop-updates";

interface DesktopUpdateGateProps {
  readonly requiredVersion: string;
  readonly currentVersion: string;
  readonly status: DesktopUpdateStatus;
  readonly title?: string;
  readonly notes?: readonly string[];
  readonly onRetry: () => void;
  readonly onInstall: () => void;
}

export function DesktopUpdateGate({ requiredVersion, currentVersion, status, title, notes, onRetry, onInstall }: DesktopUpdateGateProps) {
  const progress = Math.max(0, Math.min(100, status.percent ?? 0));
  return <main className="desktop-update-gate" aria-labelledby="desktop-update-title">
    <section className="desktop-update-gate-card" role="dialog" aria-modal="true" aria-labelledby="desktop-update-title">
      <CompanyLogo tone="color" />
      <span className="desktop-update-kicker">Обновление рабочего пространства</span>
      <h1 id="desktop-update-title">{title || "Нужна новая версия Yuksalish"}</h1>
      <p>Администратор включил обязательное обновление. Рабочие разделы откроются после установки версии {requiredVersion} или новее.</p>
      <div className="desktop-update-versions"><span>Сейчас {currentVersion}</span><span>Нужно {requiredVersion}+</span></div>
      {notes?.length ? <ul className="desktop-update-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      {status.phase === "downloading" ? <div className="desktop-update-progress">
        <span>Загружаем установщик · {Math.round(progress)}%</span>
        <progress value={progress} max={100} aria-label="Загрузка обновления" />
      </div> : null}
      {status.phase === "ready" ? <p role="status">Сборка загружена и проверена. Можно установить её сейчас.</p> : null}
      {status.phase === "checking" || status.phase === "available" || status.phase === "idle" ? <p role="status">Проверяем и загружаем обновление…</p> : null}
      {status.phase === "error" ? <p className="desktop-update-error" role="alert">Не удалось загрузить обновление. Проверьте соединение с сервером и повторите попытку. Если ошибка повторится, сообщите администратору.</p> : null}
      {status.phase === "current" ? <p className="desktop-update-error" role="alert">Сервер требует более новую версию, но установщик пока не найден. Обратитесь к администратору.</p> : null}
      <div className="desktop-update-actions">
        {status.phase === "ready" ? <Button appearance="primary" onClick={onInstall}>Установить и продолжить</Button> : <Button appearance="primary" disabled={status.phase === "downloading" || status.phase === "checking"} onClick={onRetry}>Повторить проверку</Button>}
      </div>
      <small>Сохранённые данные останутся на сервере. Если вы заполняли форму, после входа проверьте её перед повторной отправкой.</small>
    </section>
  </main>;
}
