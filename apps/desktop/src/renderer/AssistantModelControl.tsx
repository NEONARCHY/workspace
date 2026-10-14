import { useId, useRef, useState } from "react";
import { Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Brain } from "lucide-react";
import type { AssistantModel } from "@yuksalish/contracts";

const levels = [
  { value: "flash-lite", label: "Лёгкая", description: "Повседневные вопросы" },
  { value: "flash", label: "Средняя", description: "Задачи, тексты и документы" },
  { value: "pro", label: "Сильная", description: "Более сложные вопросы" },
] as const;

export function AssistantModelControl({ value, onChange, disabled = false, mountNode }: {
  readonly value: AssistantModel;
  readonly onChange: (model: AssistantModel) => void;
  readonly disabled?: boolean;
  readonly mountNode?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const index = Math.max(0, levels.findIndex(level => level.value === value));
  const selected = levels[index] ?? levels[0];
  return <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning="above-start" mountNode={mountNode} trapFocus>
    <PopoverTrigger disableButtonEnhancement>
      <button ref={trigger} type="button" className="assistant-model-trigger" disabled={disabled}
        aria-label="Выбрать мощность модели" aria-expanded={open} title={`Модель: ${selected.label}`}>
        <Brain size={20} aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverSurface role="group" className="assistant-model-popover" aria-label="Мощность модели"
      onKeyDownCapture={event => {
        if (event.key !== "Escape") return;
        // Escape closes this layer, not the surrounding assistant or its draft.
        event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
      }}>
      <div className="assistant-model-heading"><strong>Мощность модели</strong></div>
      <div className="assistant-model-scale">
        <div className="assistant-model-stops" aria-hidden="true"><i /><i /><i /></div>
        <input type="range" min={0} max={2} step={1} value={index} disabled={disabled}
          aria-label="Мощность модели" aria-valuetext={selected.label} aria-describedby={descriptionId}
          onChange={event => {
            const next = levels[Number(event.currentTarget.value)];
            if (next) onChange(next.value);
          }} />
      </div>
      <div className="assistant-model-levels" aria-hidden="true">{levels.map(level => <span key={level.value}>{level.label}</span>)}</div>
      <p id={descriptionId}>{selected.description}</p>
    </PopoverSurface>
  </Popover>;
}
