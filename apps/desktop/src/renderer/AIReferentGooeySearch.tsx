import type { CSSProperties } from "react";
import { Input } from "./WorkspaceInput";

interface AIReferentGooeySearchProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoComplete?: string;
  readonly className?: string;
  readonly collapsedWidth?: number;
  readonly expandedOffset?: number;
  readonly gooeyBlur?: number;
}

export function AIReferentGooeySearch({
  value, onValueChange, placeholder, ariaLabel, autoComplete = "off",
  className = "", collapsedWidth = 340, expandedOffset = 51,
}: AIReferentGooeySearchProps) {
  return <Input expandable className={`ai-gooey-search ${className}`.trim()}
    style={{ "--search-width": `${collapsedWidth}px`, "--search-growth": `${expandedOffset}px` } as CSSProperties}
    aria-label={ariaLabel} autoComplete={autoComplete} placeholder={placeholder} value={value}
    onChange={(_, data) => onValueChange(data.value)} />;
}
