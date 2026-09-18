import { useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import {
  Delete24Regular,
  Mic24Regular,
  Send24Filled,
  Stop24Filled,
} from "@fluentui/react-icons";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
import {
  applyAudioOutput,
  getAudioDevicePreferences,
  microphoneConstraints,
  resetAudioDevicePreference,
  subscribeToAudioDevicePreferences,
} from "./AudioDeviceSettings";

export const VOICE_MIME_TYPE = "audio/webm;codecs=opus";
const VOICE_MIME_FALLBACK = "audio/webm";
export const VOICE_BITS_PER_SECOND = 32_000;
export const VOICE_MAX_DURATION_MS = 10 * 60 * 1_000;
export const VOICE_MIN_DURATION_MS = 500;
const MICROPHONE_REQUEST_TIMEOUT_MS = 12_000;

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function supportsCompressedVoiceRecording() {
  return typeof MediaRecorder !== "undefined"
    && typeof MediaRecorder.isTypeSupported === "function"
    && (MediaRecorder.isTypeSupported(VOICE_MIME_TYPE)
      || MediaRecorder.isTypeSupported(VOICE_MIME_FALLBACK))
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

function supportedVoiceMimeType() {
  return MediaRecorder.isTypeSupported(VOICE_MIME_TYPE)
    ? VOICE_MIME_TYPE
    : VOICE_MIME_FALLBACK;
}

interface VoiceRecorderProps {
  readonly disabled?: boolean;
  readonly onClose: () => void;
  readonly onSend: (file: File, durationMs: number) => Promise<boolean>;
}

export function VoiceRecorder({ disabled, onClose, onSend }: VoiceRecorderProps) {
  const [state, setState] = useState<"requesting" | "recording" | "ready" | "error">("requesting");
  const [durationMs, setDurationMs] = useState(0);
  const [blob, setBlob] = useState<Blob>();
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [preferences, setPreferences] = useState(getAudioDevicePreferences);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  };
  const clearTimer = () => {
    if (timerRef.current !== undefined) window.clearInterval(timerRef.current);
    timerRef.current = undefined;
  };
  const stop = () => {
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestIdRef.current;
    const requestMicrophone = async (constraints: MediaTrackConstraints) => {
      let expired = false;
      let timeoutId = 0;
      const request = navigator.mediaDevices.getUserMedia({ audio: constraints });
      void request.then((lateStream) => {
        if (expired) lateStream.getTracks().forEach((track) => track.stop());
      }).catch(() => undefined);
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          expired = true;
          reject(new DOMException("Microphone request timed out", "AbortError"));
        }, MICROPHONE_REQUEST_TIMEOUT_MS);
      });
      try {
        return await Promise.race([request, timeout]);
      } finally {
        window.clearTimeout(timeoutId);
      }
    };
    const start = async () => {
      setState("requesting");
      setError("");
      if (!window.isSecureContext) {
        setState("error");
        setError("Браузер не разрешает микрофон на недоверенном адресе. Откройте защищённую LAN-ссылку или desktop-приложение.");
        return;
      }
      if (!supportsCompressedVoiceRecording()) {
        setState("error");
        setError("Формат голосовой записи не поддерживается на этом компьютере. Обновите приложение или Chromium.");
        return;
      }
      try {
        let stream: MediaStream;
        try {
          stream = await requestMicrophone(microphoneConstraints());
        } catch (cause) {
          const selected = getAudioDevicePreferences().inputDeviceId;
          if (selected === "default" || !(cause instanceof DOMException) || !["NotFoundError", "OverconstrainedError"].includes(cause.name)) throw cause;
          const fallback = resetAudioDevicePreference("input");
          setPreferences(fallback);
          stream = await requestMicrophone(microphoneConstraints(fallback));
        }
        if (!mountedRef.current || requestId !== requestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        chunksRef.current = [];
        const recorder = new MediaRecorder(stream, {
          mimeType: supportedVoiceMimeType(),
          audioBitsPerSecond: VOICE_BITS_PER_SECOND,
        });
        recorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunksRef.current.push(event.data);
        };
        recorder.onerror = () => {
          clearTimer();
          releaseStream();
          if (mountedRef.current) {
            setState("error");
            setError("Запись прервалась. Проверьте микрофон и попробуйте ещё раз.");
          }
        };
        recorder.onstop = () => {
          clearTimer();
          releaseStream();
          if (!mountedRef.current) return;
          const elapsed = Math.min(VOICE_MAX_DURATION_MS, Math.max(0, performance.now() - startedAtRef.current));
          setDurationMs(elapsed);
          const recorded = new Blob(chunksRef.current, {
            type: recorder.mimeType || supportedVoiceMimeType(),
          });
          if (elapsed < VOICE_MIN_DURATION_MS || !recorded.size) {
            setState("error");
            setError("Сообщение слишком короткое. Запишите хотя бы полсекунды.");
            return;
          }
          setBlob(recorded);
          setPreviewUrl(URL.createObjectURL(recorded));
          setState("ready");
        };
        startedAtRef.current = performance.now();
        recorder.start(1_000);
        setState("recording");
        timerRef.current = window.setInterval(() => {
          const elapsed = Math.min(VOICE_MAX_DURATION_MS, performance.now() - startedAtRef.current);
          setDurationMs(elapsed);
          if (elapsed >= VOICE_MAX_DURATION_MS) {
            clearTimer();
            if (recorder.state === "recording") recorder.stop();
          }
        }, 200);
      } catch (cause) {
        if (!mountedRef.current) return;
        setState("error");
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Доступ к микрофону запрещён. Разрешите его для Yuksalish Workspace и повторите."
          : cause instanceof DOMException && cause.name === "AbortError"
            ? "Браузер не ответил на запрос микрофона. Проверьте значок разрешения у адресной строки и повторите."
            : "Микрофон недоступен. Проверьте подключение или выберите другой в настройках.");
      }
    };
    void start();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        if (recorder.state === "recording") recorder.stop();
      }
      releaseStream();
    };
  }, [attempt]);

  useEffect(() => subscribeToAudioDevicePreferences(setPreferences), []);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const send = async () => {
    if (!blob || disabled || sending) return;
    setSending(true);
    setError("");
    try {
      const file = new File(
        [blob],
        `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
        { type: blob.type || VOICE_MIME_TYPE },
      );
      if (await onSend(file, Math.round(durationMs))) onClose();
      else setError("Голосовое сообщение не отправлено. Запись сохранена на экране — попробуйте снова.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отправить голосовое сообщение.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`voice-recorder voice-recorder-${state}`} role="region" aria-label="Запись голосового сообщения">
      <div className="voice-recorder-state">
        <span className="voice-recorder-indicator"><Mic24Regular /></span>
        <div>
          <strong>{state === "requesting" ? "Подключаем микрофон" : state === "recording" ? "Идёт запись" : state === "ready" ? "Запись готова" : "Не удалось записать"}</strong>
          <small>{state === "recording" || state === "ready"
            ? formatDuration(durationMs)
            : error || "Используется микрофон из настроек Workspace"}</small>
        </div>
      </div>
      {state === "ready" && previewUrl ? (
        <audio
          ref={(element) => {
            if (element) void applyAudioOutput(element, preferences).catch(async () => {
              await applyAudioOutput(element, resetAudioDevicePreference("output")).catch(() => undefined);
            });
          }}
          className="voice-preview"
          controls
          preload="metadata"
          src={previewUrl}
        />
      ) : null}
      <div className="voice-recorder-actions">
        {state === "recording" ? (
          <Button icon={<Stop24Filled />} appearance="primary" disabled={disabled} onClick={stop}>Завершить</Button>
        ) : null}
        {state === "ready" ? (
          <Button icon={<Send24Filled />} appearance="primary" disabled={disabled || sending} onClick={() => void send()}>
            {sending ? "Отправляем…" : "Отправить"}
          </Button>
        ) : null}
        {state === "error" ? (
          <Button appearance="primary" disabled={disabled} onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </Button>
        ) : null}
        <Button icon={<Delete24Regular />} appearance="subtle" disabled={sending} onClick={onClose}>
          {state === "ready" ? "Удалить запись" : "Отмена"}
        </Button>
      </div>
      {error && state !== "error" ? <p className="voice-recorder-error" role="alert">{error}</p> : null}
    </div>
  );
}

interface VoiceMessagePlayerProps {
  readonly attachment: WorkspaceAttachment;
  readonly onLoad: (attachment: WorkspaceAttachment) => Promise<Blob>;
}

export function VoiceMessagePlayer({ attachment, onLoad }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState(getAudioDevicePreferences);

  useEffect(() => subscribeToAudioDevicePreferences(setPreferences), []);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && url) void applyAudioOutput(audio, preferences).catch(async () => {
      const fallback = resetAudioDevicePreference("output");
      setPreferences(fallback);
      await applyAudioOutput(audio, fallback).catch(() => undefined);
      setError("Выбранное устройство отключено — звук направлен на системное.");
    });
  }, [preferences, url]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const load = async () => {
    if (loading || url) return;
    setLoading(true);
    setError("");
    try {
      setUrl(URL.createObjectURL(await onLoad(attachment)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить запись.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voice-message">
      <span className="voice-message-icon"><Mic24Regular /></span>
      {url ? (
        <audio ref={audioRef} controls preload="metadata" src={url} aria-label="Голосовое сообщение" />
      ) : (
        <Tooltip content="Файл загружается только при прослушивании" relationship="description">
          <Button size="small" appearance="subtle" disabled={loading} onClick={() => void load()}>
            {loading ? "Загрузка…" : "Прослушать"}
          </Button>
        </Tooltip>
      )}
      <small>{formatDuration(attachment.mediaDurationMs ?? 0)} · {Math.max(1, Math.round(attachment.byteSize / 1024))} КБ</small>
      {error ? <span className="voice-message-error" role="status">{error}</span> : null}
    </div>
  );
}
