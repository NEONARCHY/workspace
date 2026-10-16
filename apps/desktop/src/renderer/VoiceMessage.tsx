import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  readonly byteSize?: number;
  readonly metadata?: ReactNode;
  readonly preview?: boolean;
  readonly onPositionChange?: (positionMs: number) => void;
}

function VoicePlayerSurface({ ariaLabel, durationMs, waveform, url = "", loading = false, onRequestUrl, onDurationChange, playbackRateControl = false, byteSize, metadata, preview = false, onPositionChange }: VoicePlayerSurfaceProps) {
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
      onTimeUpdate={(event) => {
        const position = event.currentTarget.currentTime * 1_000;
        setCurrentTimeMs(position);
        onPositionChange?.(position);
      }}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setCurrentTimeMs(0); onPositionChange?.(0); }}
    />
    <div className={`voice-player${loading ? " loading" : ""}${playbackRateControl ? " has-speed" : ""}`}>
      <Button className="voice-player-play media-player-play" appearance="subtle" icon={playing ? <Pause24Filled /> : <Play24Filled />} aria-label={loading ? "Загрузка голосового сообщения" : playing ? "Пауза" : "Воспроизвести"} disabled={loading} onClick={() => void togglePlayback()} />
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
            onPositionChange?.(nextMs);
          }}
        />
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
      <MediaVolumeControl mediaRef={audioRef} className="voice-player-volume" />
      {!preview ? <div className="voice-player-details">
        <span className="voice-player-time">{formatDuration(currentTimeMs > 0 || playing ? currentTimeMs : durationMs)}
          {byteSize !== undefined ? <span className="voice-message-size">, {Math.max(1, Math.round(byteSize / 1024))} КБ</span> : null}
        </span>
        {metadata}
      </div> : null}
    </div>
    {error ? <span className="voice-message-error" role="status">{error}</span> : null}
  </>;
}

export function supportsCompressedVoiceRecording(allowMp4 = false) {
  return typeof MediaRecorder !== "undefined"
    && typeof MediaRecorder.isTypeSupported === "function"
    && (MediaRecorder.isTypeSupported(VOICE_MIME_TYPE)
      || MediaRecorder.isTypeSupported(VOICE_MIME_FALLBACK)
      || (allowMp4 && MediaRecorder.isTypeSupported("audio/mp4")))
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function supportedVoiceMimeType(allowMp4 = false) {
  return MediaRecorder.isTypeSupported(VOICE_MIME_TYPE)
    ? VOICE_MIME_TYPE
    : allowMp4 && !MediaRecorder.isTypeSupported(VOICE_MIME_FALLBACK)
      ? "audio/mp4" : VOICE_MIME_FALLBACK;
}

export function voiceRecordingExtension(mimeType: string) {
  return mimeType.split(";", 1)[0]?.toLowerCase() === "audio/mp4" ? "m4a" : "webm";
}

/** MP4/AAC must use the generic attachment path, not WebM/Opus metadata. */
export function sendMessengerRecording<T>(file: File, durationMs: number,
  sendAudio: (file: File) => T | Promise<T>,
  sendVoice: (file: File, durationMs: number) => Promise<T>) {
  return file.type.split(";", 1)[0]?.toLowerCase() === "audio/mp4"
    ? sendAudio(file) : sendVoice(file, durationMs);
}

interface VoiceRecorderProps {
  /** Generic messenger attachments accept MP4; Referent's WebM contract does not. */
  readonly allowMp4?: boolean;
  readonly disabled?: boolean;
  readonly maxDurationMs?: number;
  readonly onClose: () => void;
  readonly onVisibilityChange?: (visible: boolean) => void;
  readonly onSend: (file: File, durationMs: number) => Promise<boolean>;
}

export function VoiceRecorder({ disabled, allowMp4 = false, maxDurationMs = VOICE_MAX_DURATION_MS, onClose, onSend, onVisibilityChange }: VoiceRecorderProps) {
  const [state, setState] = useState<"requesting" | "recording" | "ready" | "error">("requesting");
  const [durationMs, setDurationMs] = useState(0);
  const [previewPositionMs, setPreviewPositionMs] = useState(0);
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
  const liveWaveformRef = useRef<SVGPathElement>(null);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const analyserFrameRef = useRef(0);
  const amplitudeSamplesRef = useRef<number[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  // Let the composer stay mounted during negotiation, then swap before paint.
  useLayoutEffect(() => { onVisibilityChange?.(state !== "requesting"); }, [state, onVisibilityChange]);

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
      if (!supportsCompressedVoiceRecording(allowMp4)) {
        setState("error");
        setError("Браузер не поддерживает доступный формат голосовой записи. Обновите браузер или используйте desktop-приложение.");
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
          audioContextRef.current = context;
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = .72;
          context.createMediaStreamSource(stream).connect(analyser);
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
              // Bound SVG work to the visible 10.8 seconds, independently of React.
              const visibleSamples = amplitudeSamplesRef.current.slice(-120);
              liveWaveformRef.current?.setAttribute("d", visibleSamples.map((sample, index) => {
                const height = Math.max(3, Math.round(sample * 40));
                return `M${index * 5 + 2} ${24 - height / 2}v${height}`;
              }).join(" "));
              lastSampleAt = now;
            }
            analyserFrameRef.current = requestAnimationFrame(measure);
          };
          analyserFrameRef.current = requestAnimationFrame(measure);
        }
        const recorder = new MediaRecorder(stream, {
          mimeType: supportedVoiceMimeType(allowMp4),
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
          const elapsed = Math.min(maxDurationMs, Math.max(0, performance.now() - startedAtRef.current));
          setDurationMs(elapsed);
          const recorded = new Blob(chunksRef.current, {
            type: recorder.mimeType || supportedVoiceMimeType(allowMp4),
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
          const elapsed = Math.min(maxDurationMs, performance.now() - startedAtRef.current);
          setDurationMs(elapsed);
          if (elapsed >= maxDurationMs) {
            clearTimer();
            if (recorder.state === "recording") recorder.stop();
          }
        }, 200);
      } catch (cause) {
        clearTimer();
        releaseStream();
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
  }, [allowMp4, attempt, maxDurationMs]);

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
        `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${voiceRecordingExtension(blob.type)}`,
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

  // Permission/device negotiation must not flash a temporary recorder banner.
  if (state === "requesting") return null;

  return (
    <div className={`voice-recorder voice-recorder-${state}`} role="region" aria-label="Запись голосового сообщения">
      <div className="voice-recorder-state">
        <span ref={indicatorRef} className="voice-recorder-indicator"><Mic24Regular /></span>
        <div>
          <strong>{state === "recording" ? "Идёт запись" : state === "ready" ? "Запись готова" : "Не удалось записать"}</strong>
          <small>{state === "recording" || state === "ready"
            ? formatDuration(state === "ready" ? Math.max(0, durationMs - previewPositionMs) : durationMs)
            : error}</small>
        </div>
      </div>
      {state === "recording" ? <svg className="voice-recorder-live-waveform" viewBox="0 0 600 48" preserveAspectRatio="none" aria-hidden="true">
        <path ref={liveWaveformRef} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg> : null}
      {state === "ready" && previewUrl ? (
        <div className="voice-preview">
          <VoicePlayerSurface
            ariaLabel="Предпрослушивание голосового сообщения"
            durationMs={durationMs}
            waveform={waveform}
            url={previewUrl}
            onDurationChange={setDurationMs}
            preview
            onPositionChange={setPreviewPositionMs}
          />
        </div>
      ) : null}
      <div className="voice-recorder-actions">
        {state === "recording" ? (
          <Button icon={<Stop24Filled />} appearance="primary" disabled={disabled} onClick={stop} title="Завершить"><span className="voice-recorder-action-label">Завершить</span></Button>
        ) : null}
        {state === "ready" ? (
          <Button icon={<Send24Filled />} appearance="primary" disabled={disabled || sending} onClick={() => void send()} title={sending ? "Отправляем…" : "Отправить"}>
            <span className="voice-recorder-action-label">{sending ? "Отправляем…" : "Отправить"}</span>
          </Button>
        ) : null}
        {state === "error" ? (
          <Button appearance="primary" disabled={disabled} onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </Button>
        ) : null}
        <Button icon={<Delete24Regular />} appearance="subtle" disabled={sending} onClick={onClose}>
          <span className="voice-recorder-action-label" title={state === "ready" ? "Удалить запись" : "Отмена"}>{state === "ready" ? "Удалить запись" : "Отмена"}</span>
        </Button>
      </div>
      {error && state !== "error" ? <p className="voice-recorder-error" role="alert">{error}</p> : null}
    </div>
  );
}

interface VoiceMessagePlayerProps {
  readonly attachment: WorkspaceAttachment;
  readonly onLoad: (attachment: WorkspaceAttachment) => Promise<Blob>;
  readonly metadata?: ReactNode;
}

export function VoiceMessagePlayer({ attachment, onLoad, metadata }: VoiceMessagePlayerProps) {
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
      <VoicePlayerSurface ariaLabel="Голосовое сообщение" durationMs={durationMs} waveform={waveform} url={url} loading={loading} onRequestUrl={load} onDurationChange={setDurationMs} playbackRateControl byteSize={attachment.byteSize} metadata={metadata} />
      {error ? <span className="voice-message-error" role="status">{error}</span> : null}
    </div>
  );
}
