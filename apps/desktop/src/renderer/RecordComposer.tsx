import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";

/** Shared presentation only: each host keeps its existing modal lifecycle and save contract. */
export function RecordComposer({ title, titleId, eyebrow, children, aside, stages, busy = false, error,
  hint, submitLabel, onClose }: {
  readonly title: string; readonly titleId: string; readonly eyebrow: string;
  readonly children: ReactNode; readonly aside: ReactNode; readonly stages?: ReactNode;
  readonly busy?: boolean; readonly error?: string; readonly hint: string;
  readonly submitLabel: string; readonly onClose: () => void;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // Disabling a focused submit button may move focus to body. Restore it inside the dialog.
    if (error && !busy) errorRef.current?.focus();
  }, [busy, error]);
  return <>
    <header className="record-composer-header">
      <div><span className="record-eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
      <Button type="button" appearance="subtle" icon={<Dismiss20Regular />} disabled={busy} onClick={onClose} aria-label="Закрыть форму создания">Закрыть</Button>
    </header>
    <div className="record-composer-body">
      {stages}
      <div className="record-composer-columns">
        <fieldset className="record-composer-fields" disabled={busy} aria-label="Данные карточки">{children}</fieldset>
        <aside className="record-composer-summary" aria-label="Сводка карточки">{aside}</aside>
      </div>
    </div>
    <footer className="record-composer-footer">
      {error ? <p ref={errorRef} tabIndex={-1} className="record-composer-error" role="alert">{error}</p> : null}
      <span>{hint}</span>
      <div><Button type="button" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy}>{busy ? "Сохраняем…" : submitLabel}</Button></div>
    </footer>
  </>;
}

export function RecordSection({ title, description, children }: { readonly title: string; readonly description?: string; readonly children: ReactNode }) {
  const titleId = useId();
  return <section className="record-section" aria-labelledby={titleId}>
    <header><h3 id={titleId}>{title}</h3>{description ? <p>{description}</p> : null}</header>
    {children}
  </section>;
}

export function RecordSummary({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className="record-summary-card"><h3>{title}</h3>{children}</section>;
}
