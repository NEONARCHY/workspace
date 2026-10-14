import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Input as FluentInput, type InputProps } from "@fluentui/react-components";
import { Search20Regular } from "@fluentui/react-icons";

/** Shared search treatment; ordinary form inputs keep Fluent's unchanged behavior. */
export const Input = forwardRef<HTMLInputElement, InputProps & { expandable?: boolean }>(function WorkspaceInput(
  { expandable, ...props }, forwardedRef,
) {
  const isSearch = expandable ?? (props.type === "search" || /поиск|найти/i.test(`${props["aria-label"] ?? ""} ${props.placeholder ?? ""}`));
  return isSearch ? <ExpandableInput {...props} ref={forwardedRef} /> : <FluentInput {...props} ref={forwardedRef} />;
});

const ExpandableInput = forwardRef<HTMLInputElement, InputProps>(function ExpandableInput(
  { className = "", style, contentBefore, onFocus, onBlur, ...props }, forwardedRef,
) {
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const morphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterId = `workspace-search-${useId().replaceAll(":", "")}`;
  const active = focused || Boolean(props.value ?? props.defaultValue);
  const beginMorph = () => {
    if (morphTimer.current) clearTimeout(morphTimer.current);
    setMorphing(true);
    morphTimer.current = setTimeout(() => { setMorphing(false); morphTimer.current = null; }, 600);
  };
  useEffect(() => () => { if (morphTimer.current) clearTimeout(morphTimer.current); }, []);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Match an adjacent control, including labelled grid fields, without a global height.
    const parent = element.parentElement;
    const row = parent?.matches("label, .fui-Field, .calendar-filter-field") ? parent.parentElement : parent;
    // Measure the complete painted control, not a segmented group's inset button.
    const surfaceSelector = ".sliding-segmented, .ws2-segmented, .fui-Dropdown, .fui-Combobox, .ws-date-time-trigger";
    const controls = [...new Set(Array.from(row?.querySelectorAll<HTMLElement>(`button, ${surfaceSelector}`) ?? [])
      .filter(control => !element.contains(control) && !control.closest(".workspace-search"))
      .map(control => control.closest<HTMLElement>(surfaceSelector) ?? control))];
    const matchHeight = () => {
      const searchRect = element.getBoundingClientRect();
      const neighbour = controls.find(control => {
        const rect = control.getBoundingClientRect();
        return rect.height >= 24 && rect.height <= 56 && rect.width > 0
          && rect.bottom > searchRect.top && rect.top < searchRect.bottom;
      });
      // Page-entry transforms must not shrink the search's permanent layout height.
      const height = neighbour && (neighbour.offsetHeight || neighbour.getBoundingClientRect().height);
      if (height) element.style.setProperty("--search-height", `${height}px`);
    };
    matchHeight();
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(matchHeight);
    observer.observe(row);
    controls.forEach(control => observer.observe(control));
    return () => observer.disconnect();
  }, []);

  return <div ref={root} className={`workspace-search ${className}`}
    style={{ ...style, "--search-morph-filter": `url(#${filterId})` } as CSSProperties}
    data-expanded={active ? "true" : "false"} data-morphing={morphing ? "true" : "false"}
    data-has-value={props.value ? "true" : "false"}>
    <svg className="workspace-search-filter" aria-hidden="true" focusable="false">
      <defs><filter id={filterId} x="-10%" y="-50%" width="120%" height="200%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
        <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" result="goo" />
        {/* Keep the real border intact: atop would clip it to the thresholded goo. */}
        <feComposite in="SourceGraphic" in2="goo" operator="over" />
      </filter></defs>
    </svg>
    <button className="workspace-search-trigger" type="button" disabled={props.disabled}
      aria-label={`Открыть: ${String(props["aria-label"] ?? props.placeholder ?? "поиск").toLocaleLowerCase("ru-RU")}`}
      tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => field.current?.focus()}>
      <Search20Regular aria-hidden="true" />
    </button>
    <FluentInput {...props} className="workspace-search-field" contentBefore={contentBefore ?? <Search20Regular aria-hidden="true" />}
      ref={element => {
        field.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      onFocus={event => { if (!active) beginMorph(); setFocused(true); onFocus?.(event); }}
      onBlur={event => { if (!props.value && !props.defaultValue) beginMorph(); setFocused(false); onBlur?.(event); }} />
  </div>;
});
