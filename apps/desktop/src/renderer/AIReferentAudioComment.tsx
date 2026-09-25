import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { AIReferentCommentAudio, AIReferentLetter } from "@yuksalish/contracts";
import { VoiceRecorder } from "./VoiceMessage";
import { downloadAIReferentCommentAudio, uploadAIReferentCommentAudio } from "./workspace-api";

export function AIReferentAudioPlayer({ token, audio }: { readonly token: string; readonly audio: AIReferentCommentAudio }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const resource = useRef("");
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; URL.revokeObjectURL(resource.current); }; }, [audio.id]);
  return <div className="ai-referent-audio-comment">
    {url ? <audio controls src={url} aria-label="Голосовой комментарий к письму" /> : <Button disabled={loading} onClick={() => {
      setLoading(true); setError("");
      void downloadAIReferentCommentAudio(token, audio.id).then((blob) => {
        if (active.current) { resource.current = URL.createObjectURL(blob); setUrl(resource.current); }
      }).catch(() => { if (active.current) setError("Не удалось загрузить запись. Попробуйте ещё раз."); })
        .finally(() => { if (active.current) setLoading(false); });
    }}>{loading ? "Загружаем…" : "Прослушать голосовой комментарий"}</Button>}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

export function AIReferentAudioComposer({ token, letter, value, onChange, disabled }: {
  readonly token: string; readonly letter: AIReferentLetter; readonly value?: AIReferentCommentAudio;
  readonly onChange: (audio: AIReferentCommentAudio | undefined) => void; readonly disabled: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  return <div className="ai-referent-audio-comment">
    {value ? <><AIReferentAudioPlayer key={value.id} token={token} audio={value} /><Button disabled={disabled} onClick={() => onChange(undefined)}>Убрать запись</Button><small>Запись будет передана вместе с возвратом письма.</small></> : null}
    {!recording ? <Button disabled={disabled} onClick={() => { setError(""); setRecording(true); }}>Записать голосовой комментарий</Button> : <VoiceRecorder
      disabled={disabled} maxDurationMs={300_000} onClose={() => setRecording(false)}
      onSend={async (file, durationMs) => {
        if (durationMs > 300_000) { setError("Комментарий должен быть не длиннее 5 минут."); return false; }
        try {
          const next = await uploadAIReferentCommentAudio(token, letter, file, durationMs);
          onChange(next); setRecording(false); return true;
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить запись."); return false; }
      }} />}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
