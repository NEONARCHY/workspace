import { useEffect, useState } from "react";
import type { AIReferentArchiveLetter, AIReferentJournalFile } from "@yuksalish/contracts";
import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwise20Regular, Chat20Regular } from "@fluentui/react-icons";
import { AIReferentFiles } from "./AIReferentFiles";
import { AIReferentGooeySearch } from "./AIReferentGooeySearch";
import { loadAIReferentArchive, loadAIReferentJournals, loadAIReferentTelegramLink } from "./workspace-api";

export function AIReferentArchive({ token }: { readonly token: string }) {
  const [letters, setLetters] = useState<readonly AIReferentArchiveLetter[]>([]);
  const [journals, setJournals] = useState<readonly AIReferentJournalFile[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      void Promise.all([loadAIReferentArchive(token, page * 50, query), loadAIReferentJournals(token)])
        .then(([archive, journal]) => { if (alive) { setLetters(archive.letters); setJournals(journal.files); } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось загрузить архив."); })
        .finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [token, page, query, revision]);
  const owners = journals.filter((item, index) => journals.findIndex((other) => other.ownerId === item.ownerId) === index);
  return <div className="ai-referent-page ai-referent-archive-page">
    <div className="ai-referent-page-intro">
      <div><span className="ai-referent-eyebrow">Архив Exat</span><h2>История переписки</h2>
        <p>Ранее обработанные исходящие письма и версии Excel-журналов. Повторная отправка из архива не запускается.</p></div>
      <span className="ai-referent-page-aside">Архив доступен для просмотра и скачивания</span>
    </div>
    <div className="ai-referent-archive-journals">
      <div><h3>Excel-журналы</h3><p>Версии, переданные роботом</p></div>
      {owners.length ? owners.map((owner) => <AIReferentFiles key={owner.ownerId} token={token} kind="journal" ownerId={owner.ownerId} letterLabel="Excel-журналы" />)
        : <span className="ai-referent-muted">Пока нет загруженных журналов</span>}
    </div>
    <div className="ai-referent-toolbar">
      <AIReferentGooeySearch
        ariaLabel="Поиск в архиве Exat"
        collapsedWidth={270}
        placeholder="Номер, тема или организация"
        value={query}
        onValueChange={(value) => { setQuery(value); setPage(0); }}
      />
      <div className="ai-referent-toolbar-actions">
        <Button icon={<ArrowClockwise20Regular />} disabled={loading} onClick={() => setRevision((value) => value + 1)}>Обновить</Button>
      </div>
    </div>
    {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
    {loading ? <div className="ai-referent-loading"><Spinner label="Загружаем архив" /></div> : null}
    {!loading && !error && letters.length === 0 ? <div className="ai-referent-empty"><h2>{query ? "Письма не найдены" : "Архив пока пуст"}</h2><p>{query ? "Попробуйте другой номер или тему." : "После синхронизации робот покажет здесь прежние письма."}</p></div> : null}
    {!loading && letters.length > 0 ? <div className="ai-incoming-table-wrap" role="region" aria-label="Архив писем" tabIndex={0}>
      <table className="ai-incoming-table ai-referent-archive-table"><thead><tr><th scope="col">Номер</th><th scope="col">Тема и получатель</th><th scope="col">Отправитель</th><th scope="col">Состояние Exat</th><th scope="col">Документы</th></tr></thead><tbody>
        {letters.map((letter) => <tr key={letter.id}><td><strong>{letter.displayNumber}</strong></td><td className="ai-incoming-subject"><strong>{letter.subject || "Без темы"}</strong><small>{letter.recipientOrganization}</small></td><td>{letter.senderName}</td><td><span className="ai-referent-archive-state">{letter.status}</span></td><td><AIReferentFiles token={token} kind="archive" ownerId={letter.id} letterLabel={`${letter.displayNumber} — ${letter.subject || "Без темы"}`} /></td></tr>)}
      </tbody></table>
    </div> : null}
    <div className="ai-referent-pagination" role="group" aria-label="Страницы архива"><Button disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Назад</Button><span>Страница {page + 1}</span><Button disabled={loading || letters.length < 50} onClick={() => setPage((value) => value + 1)}>Далее</Button></div>
  </div>;
}

export function AIReferentTelegram({ token }: { readonly token: string }) {
  const [telegramId, setTelegramId] = useState<string | null>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => { void loadAIReferentTelegramLink(token).then((value) => { if (alive) setTelegramId(value.telegramId); }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось проверить привязку."); }); };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [token]);
  return <div className="ai-referent-page ai-referent-telegram-page">
    <div className="ai-referent-page-intro"><div><span className="ai-referent-eyebrow">Личный канал</span><h2>Workspace и Telegram</h2>
      <p>Получайте уведомления и продолжайте работу с письмами через корпоративного бота.</p></div></div>
    <section className="ai-referent-telegram-card">
      <div className="ai-referent-telegram-illustration" aria-hidden="true"><span className="ai-referent-mail-shape">✉</span><span className="ai-referent-telegram-link">↗</span><Chat20Regular /></div>
      <div className="ai-referent-telegram-copy">
        <span className="ai-referent-eyebrow">{telegramId ? "ID назначен" : "Ожидает настройки"}</span>
        <h3>{telegramId ? "Telegram ID указан администратором" : "Попросите администратора подключить Telegram"}</h3>
        <p>{telegramId ? `Telegram ID: ${telegramId}. Дополнительная привязка не нужна. Откройте чат с ботом и нажмите «Старт»; доступ к боту администратор выдаёт отдельно.` : "Администратор укажет ваш Telegram ID и выдаст доступ к AI Referent. После сохранения откройте чат с ботом и нажмите «Старт» — код привязки не требуется."}</p>
        {error ? <p className="ai-referent-feedback" role="alert">{error}</p> : null}
      </div>
    </section>
    <p className="ai-referent-telegram-note">Доступ к боту и право согласовывать письма — разные настройки. Администратор управляет ими отдельно.</p>
  </div>;
}
