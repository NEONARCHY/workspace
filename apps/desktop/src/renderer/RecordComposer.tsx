import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";

/** Shared presentation only: each host keeps its existing modal lifecycle and save contract. */
export function RecordComposer({ title, titleId, eyebrow, children, aside, stages, busy = false, error,
  hint, submitLabel, submitDisabled = false, onClose }: {
  readonly title: string; readonly titleId: string; readonly eyebrow: string;
  readonly children: ReactNode; readonly aside: ReactNode; readonly stages?: ReactNode;
  readonly busy?: boolean; readonly error?: string; readonly hint: string;
  readonly submitLabel: string; readonly submitDisabled?: boolean; readonly onClose: () => void;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // Disabling a focused submit button may move focus to body. Restore it inside the dialog.
    if (error && !busy) errorRef.current?.focus();
  }, [busy, error]);
  return <>
    <header className="record-composer-header">
      <div><span className="record-eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div>
      <Button type="button" appearance="subtle" icon={<Dismiss20Regular />} disabled={busy} onClick={onClose} aria-label="Закрыть форму создания" />
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
      <div><Button type="button" disabled={busy} onClick={onClose}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy || submitDisabled}>{busy ? "Сохраняем…" : submitLabel}</Button></div>
    </footer>
  </>;
}

export function RecordSection({ title, description, children, collapsible = false, summary }: { readonly title: string; readonly description?: string; readonly children: ReactNode; readonly collapsible?: boolean; readonly summary?: string }) {
  const titleId = useId();
  if (collapsible) return <details className="record-section record-disclosure">
    <summary><span><strong>{title}</strong><small>{summary || description}</small></span><span className="disclosure-plus" aria-hidden="true">+</span></summary>
    <div className="record-disclosure-body">{children}</div>
  </details>;
  return <section className="record-section" aria-labelledby={titleId}>
    <header><h3 id={titleId}>{title}</h3>{description ? <p>{description}</p> : null}</header>
    {children}
  </section>;
}

export function RecordSummary({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section className="record-summary-card"><h3>{title}</h3>{children}</section>;
}
