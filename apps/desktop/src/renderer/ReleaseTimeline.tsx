import { CheckmarkCircle20Regular } from "@fluentui/react-icons";
import { useId } from "react";
import type { ReleaseTimelineEntry } from "./release-history";
import { formatReleaseDate } from "./release-history";

export function ReleaseTimeline({ entries }: { readonly entries: readonly ReleaseTimelineEntry[] }) {
  const headingPrefix = useId();
  return <div className="release-timeline" aria-label="Изменения по версиям">
    {entries.map((entry, index) => <section className="release-timeline-entry" key={entry.id} aria-labelledby={`${headingPrefix}-${index}`}>
      <div className="release-timeline-rail" aria-hidden="true"><span /></div>
      <div className="release-timeline-body">
        <header><div><span className="release-version-label">Версия {entry.version}</span>
          <h3 id={`${headingPrefix}-${index}`}>{entry.title}</h3></div>
          {entry.date ? <time dateTime={entry.date}>{formatReleaseDate(entry.date)}</time> : null}</header>
        {entry.items.length ? <ul>{entry.items.map((item, itemIndex) => <li key={`${entry.id}:${itemIndex}`}>
          <CheckmarkCircle20Regular aria-hidden="true" /><span>{item}</span>
        </li>)}</ul> : <p>Для этой версии нет подробного описания.</p>}
      </div>
    </section>)}
  </div>;
}
