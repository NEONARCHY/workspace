import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@fluentui/react-components";

interface TripSignaturePadProps {
  readonly disabled?: boolean;
  readonly saved?: boolean;
  readonly onSave: (content: Blob) => Promise<boolean>;
}

export function TripSignaturePad({ disabled = false, saved = false, onSave }: TripSignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.max(320, Math.round(canvas.getBoundingClientRect().width || 500));
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(160 * scale);
    const context = canvas.getContext("2d");
    context?.setTransform(scale, 0, 0, scale, 0, 0);
    if (context) {
      context.strokeStyle = "#293A55";
      context.lineWidth = 2.6;
      context.lineCap = "round";
      context.lineJoin = "round";
    }
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || busy) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(next.x, next.y);
    context.lineTo(next.x + 0.01, next.y + 0.01);
    context.stroke();
    drawing.current = true;
    setHasInk(true);
    setFile(undefined);
    setError("");
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const next = point(event);
    context.lineTo(next.x, next.y);
    context.stroke();
  };
  const stop = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    event.currentTarget.getContext("2d")?.closePath();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    drawing.current = false;
    setHasInk(false);
    setFile(undefined);
    setError("");
  };
  const save = async () => {
    if (disabled || busy) return;
    let content: Blob | null = file ?? null;
    const canvas = canvasRef.current;
    if (!content && hasInk && canvas) {
      content = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    }
    if (!content) {
      setError("Сначала нарисуйте подпись или выберите PNG.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!await onSave(content)) {
        setError("Подпись не сохранилась. Проверьте файл и повторите.");
      }
    } catch {
      setError("Не удалось сохранить подпись. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="trip-signature-pad">
    <p className="trip-signature-help">Нарисуйте подпись мышью или пальцем. До отправки её можно очистить и поставить заново.</p>
    <canvas ref={canvasRef} aria-label="Поле для рисования подписи" role="img"
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
    <div className="trip-signature-controls">
      <Button type="button" disabled={disabled || busy || (!hasInk && !file)} onClick={clear}>Очистить</Button>
      <label className="trip-signature-file">Прозрачный PNG вместо рисования
        <input type="file" accept="image/png" disabled={disabled || busy}
          aria-label="Выбрать прозрачный PNG подписи" onChange={(event) => {
            canvasRef.current?.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            setFile(event.target.files?.[0]); setHasInk(false); setError("");
          }} />
      </label>
      <Button type="button" appearance="primary" disabled={disabled || busy || (!hasInk && !file)}
        onClick={() => void save()}>{busy ? "Сохраняем…" : saved ? "Заменить подпись" : "Сохранить подпись"}</Button>
    </div>
    {saved ? <p role="status">Подпись сохранена. При изменении заявки потребуется подписать её снова.</p> : null}
    {error ? <p role="alert" className="trip-signature-error">{error}</p> : null}
  </div>;
}
