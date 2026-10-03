import { Button } from "@fluentui/react-components";
import { ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";

export function AIReferentPagination({ label, page, found, loading, hasNext, onPageChange }: {
  readonly label: string;
  readonly page: number;
  readonly found?: number;
  readonly loading: boolean;
  readonly hasNext: boolean;
  readonly onPageChange: (page: number) => void;
}) {
  return <div className="ai-referent-pagination" role="group" aria-label={label}>
    <span aria-live="polite">Страница {page + 1}{found === undefined ? "" : ` · Найдено ${found}`}</span>
    <Button appearance="subtle" icon={<ChevronLeft20Regular />} aria-label="Назад" title="Предыдущая страница"
      disabled={loading || page === 0} onClick={() => onPageChange(page - 1)} />
    <Button appearance="subtle" icon={<ChevronRight20Regular />} aria-label="Далее" title="Следующая страница"
      disabled={loading || !hasNext} onClick={() => onPageChange(page + 1)} />
  </div>;
}
