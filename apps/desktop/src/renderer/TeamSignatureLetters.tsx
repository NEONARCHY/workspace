import { useEffect, useState } from "react";
import type { AIReferentRegistry } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { ArrowRight20Regular } from "@fluentui/react-icons";
import { AIReferentPagination } from "./AIReferentPagination";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { loadSignatureInbox } from "./workspace-api";
import { employeeDisplayName } from "./employee-display-name";

const pageSize = 20;

export function useSignatureInbox(token: string, currentUserId: string, enabled: boolean) {
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [resource, setResource] = useState<{ key: string; registry?: AIReferentRegistry; error?: string }>();
  const key = JSON.stringify([token, currentUserId, page, revision]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const registry = await loadSignatureInbox(token, page * pageSize);
        if (!active) return;
        if (page > 0 && page * pageSize >= registry.totalCount) {
          setPage(Math.max(0, Math.ceil(registry.totalCount / pageSize) - 1));
        } else {
          setResource({ key, registry });
        }
      } catch (error: unknown) {
        if (active) setResource({ key, error: error instanceof Error ? error.message : "Не удалось загрузить письма на подпись." });
      } finally {
        busy = false;
      }
    };
    void refresh();
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(refreshVisible, 15000);
    window.addEventListener("focus", refreshVisible);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refreshVisible); };
  }, [enabled, key, token, page]);
  const current = enabled && resource?.key === key ? resource : undefined;
  return {
    registry: current?.registry, error: current?.error, loading: enabled && !current,
    page, setPage, refresh: () => setRevision(value => value + 1),
  };
}

export function TeamSignatureLetters({ inbox, onSelect }: {
  readonly inbox: ReturnType<typeof useSignatureInbox>;
  readonly onSelect: (letterId: string) => void;
}) {
  const { registry, loading, error, page, setPage, refresh } = inbox;
  return <>
    <p>Исходящие письма и документы «На подпись», где сейчас требуется ваше согласование. Подписание доступно в карточке документа.</p>
    {error ? <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={refresh}>Повторить загрузку писем</Button>}>{error}</WorkspaceNotice> : null}
    {loading ? <LoadingSkeleton layout="rows" label="Загружаем письма на подпись" /> : null}
    {registry ? <>
      <div className="team-dash-signature-list" role="region" aria-label="Список писем на подпись" tabIndex={0}>
        {registry.letters.map(letter => <button type="button" className="team-dash-payment-item" key={letter.id} onClick={() => onSelect(letter.id)}>
          <strong>{letter.subject}</strong>
          <span>{letter.workflowKind === "sign_only" ? "Без отправки" : letter.recipientOrganization} · {employeeDisplayName(letter.createdByName)}</span>
          <ArrowRight20Regular aria-hidden="true" />
        </button>)}
        {!registry.totalCount ? <p>Писем, ожидающих вашей подписи, нет.</p> : null}
      </div>
      <AIReferentPagination label="Страницы писем на подпись" page={page} found={registry.totalCount} loading={loading} hasNext={(page + 1) * pageSize < registry.totalCount} onPageChange={setPage} />
      <Button appearance="subtle" onClick={refresh}>Обновить письма</Button>
    </> : null}
  </>;
}
