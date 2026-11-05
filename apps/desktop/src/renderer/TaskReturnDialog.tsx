import { useEffect, useId, useRef, useState } from "react";
import type { TaskReturnReason } from "@yuksalish/contracts";
import {
  Button, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Textarea,
} from "@fluentui/react-components";
import { ArrowUndo24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSelect } from "./WorkspaceSelect";
import "./task-return-dialog.css";

interface TaskReturnDialogProps {
  readonly open: boolean;
  readonly taskTitle: string;
  readonly onClose: () => void;
  readonly onSubmit: (reason: TaskReturnReason, text: string) => Promise<boolean>;
}

export function TaskReturnDialog({ open, taskTitle, onClose, onSubmit }: TaskReturnDialogProps) {
  const descriptionId = useId();
  const [reason, setReason] = useState<TaskReturnReason>("corrections_required");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const explanationRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the explanation after Fluent has mounted and activated the nested surface.
    const frame = requestAnimationFrame(() => explanationRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const submit = async () => {
    if (!open || locked.current) return;
    if (reason === "other" && !text.trim()) {
      setError("Для другой причины добавьте пояснение.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (await onSubmit(reason, text.trim())) {
        setText("");
        setReason("corrections_required");
        onClose();
      } else {
        setError("Не удалось вернуть задачу на доработку. Пояснение сохранено — проверьте состояние задачи и повторите попытку.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось вернуть задачу на доработку.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <WorkspaceDialog open={open} onOpenChange={(_, data) => {
    if (!data.open && !locked.current) onClose();
  }}>
    <DialogSurface className="task-return-dialog" aria-describedby={descriptionId} aria-busy={busy}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <DialogBody>
          <DialogTitle action={{ className: "task-return-close", children: <Button appearance="subtle" shape="circular"
            icon={<Dismiss24Regular />} aria-label="Закрыть окно возврата"
            disabled={!open || busy} onClick={onClose} /> }}>
            <span className="task-return-heading"><span className="task-return-icon" aria-hidden="true"><ArrowUndo24Regular /></span>Вернуть на доработку</span>
          </DialogTitle>
          <DialogContent>
            <div className="task-return-context"><span>Задача</span><strong>{taskTitle}</strong></div>
            <p id={descriptionId} className="task-return-description">Укажите причину и поясните, что нужно исправить. Исполнители получат уведомление, а результат потребуется отправить на проверку заново.</p>
            <Field label="Причина возврата">
              <WorkspaceSelect aria-label="Причина возврата" value={reason} disabled={!open || busy}
                onChange={(event) => { setReason(event.target.value as TaskReturnReason); setError(""); }}>
                <option value="corrections_required">Нужны исправления</option>
                <option value="incomplete_result">Результат неполный</option>
                <option value="requirements_not_met">Требования не выполнены</option>
                <option value="other">Другая причина</option>
              </WorkspaceSelect>
            </Field>
            <Field label="Что нужно исправить" required={reason === "other"}>
              <Textarea textarea={{ ref: explanationRef }} aria-label="Пояснение причины" rows={6} value={text}
                disabled={!open || busy} placeholder="Опишите замечания и ожидаемые исправления"
                onChange={(_, data) => { setText(data.value); setError(""); }} />
            </Field>
            {error ? <WorkspaceNotice tone="error" role="alert">{error}</WorkspaceNotice> : null}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={!open || busy} onClick={onClose}>Отмена</Button>
            <Button appearance="primary" type="submit" icon={<ArrowUndo24Regular />} disabled={!open || busy}>
              {busy ? "Возврат…" : "Вернуть исполнителям"}
            </Button>
          </DialogActions>
        </DialogBody>
      </form>
    </DialogSurface>
  </WorkspaceDialog>;
}
