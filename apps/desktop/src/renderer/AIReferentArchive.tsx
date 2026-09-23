import { useEffect, useState } from "react";
import type { AIReferentArchiveLetter, AIReferentJournalFile } from "@yuksalish/contracts";
import { Button, Input, Spinner } from "@fluentui/react-components";
import { AIReferentFiles } from "./AIReferentFiles";
import { loadAIReferentArchive, loadAIReferentJournals, loadAIReferentTelegramLink, createAIReferentTelegramLink } from "./workspace-api";

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
  return <div className="ai-incoming-register">
    <div className="ai-referent-toolbar"><Input aria-label="Поиск в архиве Exat" placeholder="Номер, тема или организация" value={query} onChange={(_event, data) => { setQuery(data.value); setPage(0); }} /><Button onClick={() => setRevision((value) => value + 1)}>Обновить</Button></div>
    <p>Ранее зарегистрированные письма Exat. История сохраняется, повторная отправка из архива не запускается.</p>
    {owners.map((owner) => <section key={owner.ownerId} className="ai-referent-detail-card"><h3>Excel-журналы · версии</h3><AIReferentFiles token={token} kind="journal" ownerId={owner.ownerId} /></section>)}
    {loading ? <Spinner label="Загружаем архив" /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && !error && letters.length === 0 ? <p>Архивных писем пока нет. Робот передаст записи после подключения.</p> : null}
    <div className="ai-incoming-table-wrap"><table className="ai-incoming-table"><thead><tr><th>Номер</th><th>Тема и получатель</th><th>Отправитель</th><th>Состояние Exat</th><th>Файлы</th></tr></thead><tbody>
      {letters.map((letter) => <tr key={letter.id}><td>{letter.displayNumber}</td><td><strong>{letter.subject}</strong><small>{letter.recipientOrganization}</small></td><td>{letter.senderName}</td><td>{letter.status}</td><td><AIReferentFiles token={token} kind="archive" ownerId={letter.id} /></td></tr>)}
    </tbody></table></div>
    <div className="ai-referent-header-actions"><Button disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)}>Назад</Button><span>Страница {page + 1}</span><Button disabled={loading || letters.length < 50} onClick={() => setPage((value) => value + 1)}>Далее</Button></div>
  </div>;
}

export function AIReferentTelegram({ token }: { readonly token: string }) {
  const [telegramId, setTelegramId] = useState<string | null>();
  const [link, setLink] = useState<{ readonly code: string; readonly expiresAt: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () => { void loadAIReferentTelegramLink(token).then((value) => { if (alive) setTelegramId(value.telegramId); }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Не удалось проверить привязку."); }); };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, [token]);
  const create = async () => {
    setBusy(true); setError("");
    try { setLink(await createAIReferentTelegramLink(token)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать код."); }
    finally { setBusy(false); }
  };
  return <section className="ai-referent-detail-card">
    <h2>Мой Telegram</h2><p>{telegramId ? `Привязан Telegram ID: ${telegramId}` : "Получайте уведомления и продолжайте работу с письмами через корпоративного бота."}</p>
    <p>Отправьте команду ниже именно корпоративному боту в личном чате. Код одноразовый и действует 10 минут. Никому его не передавайте. Назначения руководителей меняет администратор во вкладке «Согласующие».</p>
    <Button appearance="primary" disabled={busy} onClick={() => void create()}>Получить код привязки</Button>
    {link ? <p><code>/link {link.code}</code><br />Действует до {new Date(link.expiresAt).toLocaleTimeString("ru-RU")}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
