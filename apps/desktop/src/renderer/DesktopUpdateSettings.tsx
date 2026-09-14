import { useEffect, useState } from "react";

import type { DesktopRelease, DesktopUpdatePolicy } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";

import {
  loadDesktopReleases,
  loadDesktopUpdatePolicy,
  publishDesktopRelease,
  setMandatoryDesktopUpdate,
  stageDesktopRelease,
} from "./workspace-api";

interface DesktopUpdateSettingsProps {
  readonly token: string;
}

function versionFromFile(file: File): string | null {
  return /^Yuksalish-Workspace-Setup-(\d+\.\d+\.\d+)\.exe$/.exec(file.name)?.[1] ?? null;
}

export function DesktopUpdateSettings({ token }: DesktopUpdateSettingsProps) {
  const [policy, setPolicy] = useState<DesktopUpdatePolicy>();
  const [releases, setReleases] = useState<readonly DesktopRelease[]>([]);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"publish" | "mandatory" | "disable" | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [feedback, setFeedback] = useState("");

  const refresh = async () => {
    const [nextPolicy, nextReleases] = await Promise.all([
      loadDesktopUpdatePolicy(token), loadDesktopReleases(token),
    ]);
    setPolicy(nextPolicy);
    setReleases(nextReleases);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([loadDesktopUpdatePolicy(token), loadDesktopReleases(token)])
      .then(([nextPolicy, nextReleases]) => {
        if (!active) return;
        setPolicy(nextPolicy);
        setReleases(nextReleases);
      })
      .catch((error: unknown) => {
        if (active) setFeedback(error instanceof Error ? error.message : "Не удалось загрузить обновления");
      });
    return () => { active = false; };
  }, [token]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setFeedback("");
    try {
      await operation();
      await refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Операция не выполнена");
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  };

  const fileVersion = file ? versionFromFile(file) : null;

  return <section className="account-section desktop-update-settings" data-account-section="updates">
    <div className="account-section-title">
      <div>
        <h3>Обновления приложения</h3>
        <p>Только суперадминистратор может загрузить сборку, опубликовать её и включить обязательное обновление.</p>
      </div>
      <span className={policy?.mandatory ? "security-warning" : "security-ok"}>
        {policy?.mandatory ? "Обязательно" : "Свободный режим"}
      </span>
    </div>
    <p>На сервере: <strong>{policy?.publishedVersion ?? "нет опубликованной версии"}</strong>. На этом ПК: <strong>{window.yuksalish?.version ?? "режим разработки"}</strong>.</p>

    <div className="desktop-update-step">
      <strong>1. Загрузить готовый установщик</strong>
      <p>Сначала проверьте сборку на тестовом ПК. Имя файла должно быть вида Yuksalish-Workspace-Setup-1.2.3.exe.</p>
      <input type="file" accept=".exe" aria-label="Готовый установщик Yuksalish" disabled={busy}
        onChange={(event) => setFile(event.target.files?.[0])} />
      {file && !fileVersion ? <small role="alert">Имя файла не содержит корректный номер версии.</small> : null}
      {fileVersion ? <Button disabled={busy} onClick={() => void run(async () => {
        await stageDesktopRelease(token, fileVersion, file!);
        setFile(undefined);
        setFeedback(`Версия ${fileVersion} загружена, но ещё не опубликована.`);
      })}>{busy ? "Загрузка…" : `Загрузить версию ${fileVersion}`}</Button> : null}
    </div>

    <div className="desktop-update-step">
      <strong>2. Опубликовать после проверки</strong>
      <p>Клиенты смогут скачать опубликованную версию. Принудительная блокировка включается отдельно.</p>
      {releases.filter((release) => !release.publishedAt).map((release) => <div key={release.version} className="desktop-update-release">
        <span>{release.version} · {(release.sizeBytes / 1024 / 1024).toFixed(1)} МиБ</span>
        <Button size="small" disabled={busy} onClick={() => { setSelectedVersion(release.version); setConfirmation("publish"); }}>Опубликовать</Button>
      </div>)}
      {releases.every((release) => release.publishedAt) ? <small>Неопубликованных сборок нет.</small> : null}
    </div>

    <div className="desktop-update-step">
      <strong>3. Обязательное обновление</strong>
      <p>На старых версиях появится экран обновления, который закроет рабочие разделы. Включайте режим только после проверки установки и доступности файла для коллег.</p>
      <Button disabled={busy || !policy?.publishedVersion} onClick={() => setConfirmation(policy?.mandatory ? "disable" : "mandatory")}>
        {policy?.mandatory ? "Выключить обязательное обновление" : "Сделать обновление обязательным"}
      </Button>
    </div>

    {confirmation ? <div className="desktop-update-confirm" role="alertdialog" aria-label="Подтверждение публикации обновления">
      <strong>{confirmation === "publish" ? `Опубликовать версию ${selectedVersion}?` : confirmation === "mandatory" ? "Заблокировать работу на старых версиях?" : "Выключить обязательное обновление?"}</strong>
      <div>
        <Button appearance="primary" disabled={busy} onClick={() => void run(async () => {
          if (confirmation === "publish") await publishDesktopRelease(token, selectedVersion);
          else await setMandatoryDesktopUpdate(token, confirmation === "mandatory");
          setFeedback("Настройка обновлений сохранена.");
        })}>Подтвердить</Button>
        <Button disabled={busy} onClick={() => setConfirmation(null)}>Отмена</Button>
      </div>
    </div> : null}
    {feedback ? <p role="status">{feedback}</p> : null}
  </section>;
}
