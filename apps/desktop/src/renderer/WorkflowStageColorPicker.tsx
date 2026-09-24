import type { CSSProperties } from "react";

import { workflowStageColors } from "./workflow-stage-colors";

interface WorkflowStageColorPickerProps {
  readonly value?: string;
  readonly usedByOtherStages: readonly string[];
  readonly onChange: (color: string | undefined) => void;
}

export function WorkflowStageColorPicker({ value, usedByOtherStages, onChange }: WorkflowStageColorPickerProps) {
  const counts = new Map<string, number>();
  for (const color of usedByOtherStages) {
    const key = color.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return (
    <fieldset className="workflow-color-picker">
      <legend>Цвет колонки</legend>
      <p>Занятые цвета отмечены, но их можно выбрать повторно.</p>
      <div className="workflow-color-options">
        <button type="button" className="workflow-color-auto" aria-pressed={!value} onClick={() => onChange(undefined)}>
          Авто
        </button>
        {workflowStageColors.map((option) => {
          const occupied = counts.get(option.accent.toLowerCase()) ?? 0;
          return (
            <button
              type="button"
              key={option.key}
              className="workflow-color-option"
              style={{ "--workflow-color-accent": option.accent, "--workflow-color-surface": option.surface } as CSSProperties}
              aria-label={`${option.label}${occupied ? `, уже используется: ${occupied}` : ", свободен"}`}
              aria-pressed={value?.toLowerCase() === option.accent.toLowerCase()}
              onClick={() => onChange(option.accent)}
            >
              <span aria-hidden="true" />
              <small>{option.label}</small>
              {occupied ? <b title={`Этот цвет уже используется в ${occupied} этапах`}>{occupied}</b> : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
