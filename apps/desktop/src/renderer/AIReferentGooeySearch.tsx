import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Search20Regular } from "@fluentui/react-icons";

interface AIReferentGooeySearchProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoComplete?: string;
  readonly className?: string;
  readonly collapsedWidth?: number;
  readonly expandedWidth?: number;
  readonly expandedOffset?: number;
  readonly gooeyBlur?: number;
}

type SearchStyle = CSSProperties & {
  "--ai-gooey-collapsed"?: string;
  "--ai-gooey-expanded"?: string;
  "--ai-gooey-offset"?: string;
};

export function AIReferentGooeySearch({
  value,
  onValueChange,
  placeholder,
  ariaLabel,
  autoComplete = "off",
  className = "",
  collapsedWidth = 340,
  expandedWidth = 480,
  expandedOffset = 51,
  gooeyBlur = 5,
}: AIReferentGooeySearchProps) {
  const [expanded, setExpanded] = useState(value.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterId = `ai-gooey-${useId().replaceAll(":", "")}`;
  const style: SearchStyle = {
    "--ai-gooey-collapsed": `${collapsedWidth}px`,
    "--ai-gooey-expanded": `${expandedWidth}px`,
    "--ai-gooey-offset": `${expandedOffset}px`,
  };

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  return (
    <div
      className={`ai-gooey-search ${className}`.trim()}
      data-expanded={expanded ? "true" : "false"}
      data-has-value={value.length > 0 ? "true" : "false"}
      style={style}
    >
      <svg className="ai-gooey-search-filter" aria-hidden="true" focusable="false">
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation={gooeyBlur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <span className="ai-gooey-search-plinth" aria-hidden="true" />
      <span className="ai-gooey-search-bubble-plinth" aria-hidden="true" />
      <div
        className="ai-gooey-search-filter-wrap"
        style={{ filter: `url(#${filterId})` }}
      >
        <div className="ai-gooey-search-row">
          <button
            type="button"
            className="ai-gooey-search-trigger"
            aria-label={`Открыть: ${ariaLabel.toLocaleLowerCase("ru-RU")}`}
            aria-hidden={expanded}
            tabIndex={expanded ? -1 : 0}
            onClick={() => setExpanded(true)}
          >
            <Search20Regular aria-hidden="true" />
            <span>{placeholder}</span>
          </button>

          <label className="ai-gooey-search-input-surface">
            <input
              ref={inputRef}
              className="ai-gooey-search-input"
              aria-label={ariaLabel}
              aria-hidden={!expanded}
              autoComplete={autoComplete}
              disabled={!expanded}
              inputMode="search"
              placeholder={placeholder}
              tabIndex={expanded ? 0 : -1}
              value={value}
              onBlur={() => { if (!value) setExpanded(false); }}
              onChange={(event) => onValueChange(event.currentTarget.value)}
            />
          </label>
        </div>

        <span className="ai-gooey-search-bubble" aria-hidden="true">
          <Search20Regular />
        </span>
      </div>
      <span className="ai-gooey-search-placeholder" aria-hidden="true">
        {placeholder}
      </span>
    </div>
  );
}
