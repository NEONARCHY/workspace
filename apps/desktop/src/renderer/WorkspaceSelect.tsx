import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { Dropdown, Option } from "@fluentui/react-components";

interface WorkspaceSelectChangeEvent {
  readonly target: { readonly value: string };
  readonly currentTarget: {
    readonly value: string;
    readonly selectedOptions: readonly { readonly value: string }[];
  };
}

interface WorkspaceSelectProps {
  readonly "aria-describedby"?: string;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
  readonly children?: ReactNode;
  readonly className?: string;
  readonly defaultValue?: string | number;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly multiple?: boolean;
  readonly onBlur?: () => void;
  readonly onChange?: (event: WorkspaceSelectChangeEvent) => void;
  readonly onFocus?: () => void;
  readonly required?: boolean;
  readonly title?: string;
  readonly value?: string | number | readonly string[];
}

interface WorkspaceOption {
  readonly disabled: boolean;
  readonly label: ReactNode;
  readonly text: string;
  readonly value: string;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return Children.toArray(node).map(textFromNode).join("");
}

function optionsFromChildren(children: ReactNode): WorkspaceOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; value?: string | number }>(child)) return [];
    if (child.type !== "option") return optionsFromChildren(child.props.children);
    const text = textFromNode(child.props.children);
    return [{
      disabled: child.props.disabled === true,
      label: child.props.children,
      text,
      value: String(child.props.value ?? text),
    }];
  });
}

/**
 * Product-styled replacement for native select popups. It deliberately accepts
 * option children and a select-like change event so existing forms keep their
 * data flow while Fluent provides keyboard navigation, focus and portal layout.
 */
export function WorkspaceSelect({
  children,
  className,
  defaultValue,
  multiple,
  onChange,
  value,
  ...props
}: WorkspaceSelectProps) {
  const controlRef = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const selectedValues = useMemo(() => (Array.isArray(value)
    ? value.map(String)
    : [String(value ?? defaultValue ?? options[0]?.value ?? "")]), [defaultValue, options, value]);
  const selected = options.filter((option) => selectedValues.includes(option.value));
  const emitChange = useCallback((nextValue: string, nextSelectedValues: readonly string[]) => {
    const selectedOptions = nextSelectedValues.map((selectedOption) => ({ value: selectedOption }));
    onChange?.({
      target: { value: nextValue },
      currentTarget: { value: nextValue, selectedOptions },
    });
  }, [onChange]);

  useLayoutEffect(() => {
    if (controlRef.current) controlRef.current.value = selectedValues[0] ?? "";
  }, [selectedValues]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !onChange) return undefined;

    // Some existing form integrations dispatch a native `change` event to a
    // select-like control. Fluent Dropdown intentionally exposes selection via
    // `onOptionSelect`, so this narrow bridge preserves that established form
    // contract without rendering a second, hidden native select.
    const handleNativeChange = (event: Event) => {
      const target = event.target as HTMLButtonElement & {
        readonly selectedOptions?: ArrayLike<{ readonly value: string }>;
      };
      const selectedOptions = target.selectedOptions
        ? Array.from(target.selectedOptions, (option) => option.value)
        : [target.value];
      emitChange(target.value, selectedOptions);
    };
    control.addEventListener("change", handleNativeChange);
    return () => control.removeEventListener("change", handleNativeChange);
  }, [emitChange, onChange]);

  return (
    <Dropdown
      {...props}
      ref={controlRef}
      className={["workspace-select", className].filter(Boolean).join(" ")}
      multiselect={multiple}
      selectedOptions={selectedValues}
      value={selected.map((option) => option.text).join(", ")}
      onOptionSelect={(_event, data) => {
        const nextValue = data.optionValue ?? "";
        emitChange(nextValue, data.selectedOptions);
      }}
    >
      {options.map((option) => (
        <Option disabled={option.disabled} key={option.value} text={option.text} value={option.value}>
          {option.label}
        </Option>
      ))}
    </Dropdown>
  );
}
