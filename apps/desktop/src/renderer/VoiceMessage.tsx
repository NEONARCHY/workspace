import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  Delete24Regular,
  Mic24Regular,
  Pause24Filled,
  Play24Filled,
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
import { MediaVolumeControl } from "./MediaVolumeControl";

export const VOICE_MIME_TYPE = "audio/webm;codecs=opus";
const VOICE_MIME_FALLBACK = "audio/webm";
export const VOICE_BITS_PER_SECOND = 32_000;
export const VOICE_MAX_DURATION_MS = 10 * 60 * 1_000;
export const VOICE_MIN_DURATION_MS = 500;
const MICROPHONE_REQUEST_TIMEOUT_MS = 12_000;
export const VOICE_PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;
type VoicePlaybackRate = typeof VOICE_PLAYBACK_RATES[number];
let preferredVoicePlaybackRate: VoicePlaybackRate = 1;

export function nextVoicePlaybackRate(current: VoicePlaybackRate): VoicePlaybackRate {
  const index = VOICE_PLAYBACK_RATES.indexOf(current);
  return VOICE_PLAYBACK_RATES[(index + 1) % VOICE_PLAYBACK_RATES.length]!;
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const WAVEFORM_BAR_COUNT = 44;

function seededWaveform(seed: string): readonly number[] {
  let value = [...seed].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 19);
  return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    const envelope = .58 + Math.sin((index / (WAVEFORM_BAR_COUNT - 1)) * Math.PI) * .42;
    return Math.round((20 + (value % 71)) * envelope);
  });
}

function normalizeWaveform(samples: readonly number[]): readonly number[] {
  if (!samples.length) return seededWaveform("voice-preview");
  return Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
    const start = Math.floor(index * samples.length / WAVEFORM_BAR_COUNT);
    const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / WAVEFORM_BAR_COUNT));
    return Math.max(12, Math.round(Math.max(...samples.slice(start, end)) * 100));
  });
}

interface VoicePlayerSurfaceProps {
  readonly ariaLabel: string;
  readonly durationMs: number;
  readonly waveform: readonly number[];
  readonly url?: string;
  readonly loading?: boolean;
  readonly onRequestUrl?: () => Promise<string | undefined>;
  readonly onDurationChange?: (durationMs: number) => void;
  readonly playbackRateControl?: boolean;
}

function VoicePlayerSurface({ ariaLabel, durationMs, waveform, url = "", loading = false, onRequestUrl, onDurationChange, playbackRateControl = false }: VoicePlayerSurfaceProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [playWhenReady, setPlayWhenReady] = useState(false);
  const [error, setError] = useState("");
  const [playbackRate, setPlaybackRate] = useState<VoicePlaybackRate>(preferredVoicePlaybackRate);
  const [preferences, setPreferences] = useState(getAudioDevicePreferences);
  const progress = durationMs > 0 ? Math.min(100, currentTimeMs / durationMs * 100) : 0;

  useEffect(() => subscribeToAudioDevicePreferences(setPreferences), []);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate, url]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url) return;
    void applyAudioOutput(audio, preferences).catch(async () => {
      const fallback = resetAudioDevicePreference("output");
      setPreferences(fallback);
      await applyAudioOutput(audio, fallback).catch(() => undefined);
      setError("Выбранное устройство отключено — звук направлен на системное.");
    });
  }, [preferences, url]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !url || !playWhenReady) return;
    setPlayWhenReady(false);
    const playback = audio.play();
    void playback?.catch(() => setError("Не удалось начать воспроизведение."));
  }, [playWhenReady, url]);

  const togglePlayback = async () => {
    setError("");
    if (!url) {
      if (!onRequestUrl || loading) return;
      setPlayWhenReady(true);
      const nextUrl = await onRequestUrl();
      if (!nextUrl) setPlayWhenReady(false);
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play()?.catch(() => setError("Не удалось начать воспроизведение."));
    else audio.pause();
  };

  return <>
    <audio
      ref={audioRef}
      className="voice-message-audio"
      preload="metadata"
      src={url || undefined}
      aria-label={ariaLabel}
      onLoadedMetadata={(event) => {
        const seconds = event.currentTarget.duration;
        if (Number.isFinite(seconds)) onDurationChange?.(seconds * 1_000);
      }}
      onTimeUpdate={(event) => setCurrentTimeMs(event.currentTarget.currentTime * 1_000)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setCurrentTimeMs(0); }}
    />
    <div className={`voice-player${loading ? " loading" : ""}${playbackRateControl ? " has-speed" : ""}`}>
      <Button className="voice-player-play" appearance="subtle" icon={playing ? <Pause24Filled /> : <Play24Filled />} aria-label={loading ? "Загрузка голосового сообщения" : playing ? "Пауза" : "Воспроизвести"} disabled={loading} onClick={() => void togglePlayback()} />
      <div className="voice-player-track">
        <div className="voice-waveform" aria-hidden="true">
          {waveform.map((height, index) => <i key={index} className={index / waveform.length * 100 <= progress ? "played" : ""} style={{ height: `${height}%` }} />)}
        </div>
        <input
          className="voice-player-progress"
          type="range"
          min="0"
          max={Math.max(1, durationMs)}
          step="100"
          value={Math.min(currentTimeMs, Math.max(1, durationMs))}
          aria-label="Позиция голосового сообщения"
          disabled={!url}
          onChange={(event) => {
            const nextMs = Number(event.currentTarget.value);
            if (audioRef.current) audioRef.current.currentTime = nextMs / 1_000;
            setCurrentTimeMs(nextMs);
          }}
        />
        <span className="voice-player-time">{formatDuration(currentTimeMs)} <i>/</i> {formatDuration(durationMs)}</span>
      </div>
      {playbackRateControl ? <Button
        className="voice-player-speed"
        appearance="subtle"
        aria-label={`Скорость воспроизведения: ${playbackRate}×`}
        onClick={() => {
          const next = nextVoicePlaybackRate(playbackRate);
          preferredVoicePlaybackRate = next;
          setPlaybackRate(next);
        }}
      >{playbackRate}×</Button> : null}
      <MediaVolumeControl mediaRef={audioRef} disabled={!url} className="voice-player-volume" />
    </div>
    {error ? <span className="voice-message-error" role="status">{error}</span> : null}
  </>;
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
  const [, setPreferences] = useState(getAudioDevicePreferences);
  const [waveform, setWaveform] = useState<readonly number[]>(() => seededWaveform("voice-preview"));
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const analyserFrameRef = useRef(0);
  const amplitudeSamplesRef = useRef<number[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  const releaseStream = () => {
    cancelAnimationFrame(analyserFrameRef.current);
    analyserFrameRef.current = 0;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = undefined;
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
        amplitudeSamplesRef.current = [];
        const AudioContextConstructor = window.AudioContext;
        if (AudioContextConstructor) {
          const context = new AudioContextConstructor();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = .72;
          context.createMediaStreamSource(stream).connect(analyser);
          audioContextRef.current = context;
          const values = new Uint8Array(analyser.fftSize);
          let lastSampleAt = 0;
          const measure = (now: number) => {
            analyser.getByteTimeDomainData(values);
            let energy = 0;
            for (const sample of values) {
              const normalized = (sample - 128) / 128;
              energy += normalized * normalized;
            }
            const level = Math.min(1, Math.sqrt(energy / values.length) * 4.5);
            indicatorRef.current?.style.setProperty("--voice-level", level.toFixed(3));
            if (now - lastSampleAt >= 90) {
              amplitudeSamplesRef.current.push(Math.max(.08, level));
              lastSampleAt = now;
            }
            analyserFrameRef.current = requestAnimationFrame(measure);
          };
          analyserFrameRef.current = requestAnimationFrame(measure);
        }
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
          setWaveform(normalizeWaveform(amplitudeSamplesRef.current));
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
        <span ref={indicatorRef} className="voice-recorder-indicator"><Mic24Regular /></span>
        <div>
          <strong>{state === "requesting" ? "Подключаем микрофон" : state === "recording" ? "Идёт запись" : state === "ready" ? "Запись готова" : "Не удалось записать"}</strong>
          <small>{state === "recording" || state === "ready"
            ? formatDuration(durationMs)
            : error || "Используется микрофон из настроек Workspace"}</small>
        </div>
      </div>
      {state === "ready" && previewUrl ? (
        <div className="voice-preview">
          <VoicePlayerSurface
            ariaLabel="Предпрослушивание голосового сообщения"
            durationMs={durationMs}
            waveform={waveform}
            url={previewUrl}
            onDurationChange={setDurationMs}
          />
        </div>
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
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [durationMs, setDurationMs] = useState(attachment.mediaDurationMs ?? 0);
  const waveform = useMemo(() => seededWaveform(attachment.id), [attachment.id]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const load = async (): Promise<string | undefined> => {
    if (loading) return undefined;
    if (url) return url;
    setLoading(true);
    setError("");
    try {
      const nextUrl = URL.createObjectURL(await onLoad(attachment));
      setUrl(nextUrl);
      return nextUrl;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить запись.");
      return undefined;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voice-message">
      <VoicePlayerSurface ariaLabel="Голосовое сообщение" durationMs={durationMs} waveform={waveform} url={url} loading={loading} onRequestUrl={load} onDurationChange={setDurationMs} playbackRateControl />
      <small className="voice-message-size">{Math.max(1, Math.round(attachment.byteSize / 1024))} КБ</small>
      {error ? <span className="voice-message-error" role="status">{error}</span> : null}
    </div>
  );
}
