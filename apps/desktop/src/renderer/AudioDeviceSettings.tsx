import { useCallback, useEffect, useState } from "react";
import { Button, Field, Select } from "@fluentui/react-components";

const STORAGE_KEY = "yuksalish.audio-devices.v1";
const CHANGE_EVENT = "yuksalish:audio-devices-changed";

export interface AudioDevicePreferences {
  readonly inputDeviceId: string;
  readonly outputDeviceId: string;
}

const defaults: AudioDevicePreferences = {
  inputDeviceId: "default",
  outputDeviceId: "default",
};

export function getAudioDevicePreferences(): AudioDevicePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AudioDevicePreferences> | null;
    return {
      inputDeviceId: saved?.inputDeviceId || "default",
      outputDeviceId: saved?.outputDeviceId || "default",
    };
  } catch {
    return defaults;
  }
}

function saveAudioDevicePreferences(preferences: AudioDevicePreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: preferences }));
}

export function resetAudioDevicePreference(kind: "input" | "output") {
  const current = getAudioDevicePreferences();
  const next = kind === "input"
    ? { ...current, inputDeviceId: "default" }
    : { ...current, outputDeviceId: "default" };
  saveAudioDevicePreferences(next);
  return next;
}

export function subscribeToAudioDevicePreferences(
  listener: (preferences: AudioDevicePreferences) => void,
) {
  const receive = (event: Event) => {
    listener((event as CustomEvent<AudioDevicePreferences>).detail);
  };
  window.addEventListener(CHANGE_EVENT, receive);
  return () => window.removeEventListener(CHANGE_EVENT, receive);
}

export function microphoneConstraints(
  preferences = getAudioDevicePreferences(),
): MediaTrackConstraints {
  return {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: { ideal: 48_000 },
    ...(preferences.inputDeviceId === "default"
      ? {}
      : { deviceId: { exact: preferences.inputDeviceId } }),
  };
}

type SinkSelectable = HTMLMediaElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

export async function applyAudioOutput(
  element: HTMLMediaElement,
  preferences = getAudioDevicePreferences(),
) {
  const selectable = element as SinkSelectable;
  if (selectable.setSinkId) {
    await selectable.setSinkId(preferences.outputDeviceId);
  }
}

function deviceName(device: MediaDeviceInfo, index: number, kind: "input" | "output") {
  if (device.label) return device.label.replace(/^Default - /i, "");
  return kind === "input" ? `Микрофон ${index + 1}` : `Динамики ${index + 1}`;
}

export function AudioDeviceSettings() {
  const [preferences, setPreferences] = useState(getAudioDevicePreferences);
  const [devices, setDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [status, setStatus] = useState("Системные устройства меняются вместе с настройками Windows.");

  const refresh = useCallback(async (requestLabels = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setStatus("На этом устройстве выбор аудиооборудования недоступен.");
      return;
    }
    let stream: MediaStream | undefined;
    try {
      if (requestLabels) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      const current = await navigator.mediaDevices.enumerateDevices();
      setDevices(current);
      setStatus("Список устройств обновлён.");
      const inputIds = new Set(current.filter((item) => item.kind === "audioinput").map((item) => item.deviceId));
      const outputIds = new Set(current.filter((item) => item.kind === "audiooutput").map((item) => item.deviceId));
      const next = {
        inputDeviceId: preferences.inputDeviceId === "default" || inputIds.has(preferences.inputDeviceId)
          ? preferences.inputDeviceId : "default",
        outputDeviceId: preferences.outputDeviceId === "default" || outputIds.has(preferences.outputDeviceId)
          ? preferences.outputDeviceId : "default",
      };
      if (next.inputDeviceId !== preferences.inputDeviceId || next.outputDeviceId !== preferences.outputDeviceId) {
        setPreferences(next);
        saveAudioDevicePreferences(next);
        setStatus("Отключённое устройство заменено системным автоматически.");
      }
    } catch (error) {
      setStatus(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Доступ к микрофону запрещён в Windows. Системное устройство всё равно останется выбранным."
        : "Не удалось обновить устройства. Проверьте настройки звука Windows.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }, [preferences]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(false), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]); // Device changes below keep the list current without reopening settings.

  useEffect(() => {
    const changed = () => void refresh(false);
    navigator.mediaDevices?.addEventListener?.("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", changed);
  }, [refresh]);

  const inputs = devices.filter((device) => device.kind === "audioinput" && !["default", "communications"].includes(device.deviceId));
  const outputs = devices.filter((device) => device.kind === "audiooutput" && !["default", "communications"].includes(device.deviceId));
  const change = (next: AudioDevicePreferences) => {
    setPreferences(next);
    saveAudioDevicePreferences(next);
    setStatus(next.inputDeviceId === "default" && next.outputDeviceId === "default"
      ? "Приложение следует за устройствами по умолчанию в Windows."
      : "Ручной выбор сохранён только на этом компьютере.");
  };

  return (
    <section className="account-section audio-device-settings">
      <div className="account-section-title">
        <div>
          <h3>Звук и устройства</h3>
          <p>Для голосовых сообщений. Системный режим автоматически следует за Windows.</p>
        </div>
      </div>
      <div className="audio-device-fields">
        <Field label="Микрофон">
          <Select
            value={preferences.inputDeviceId}
            onChange={(event) => change({ ...preferences, inputDeviceId: event.target.value })}
          >
            <option value="default">Системный микрофон — автоматически</option>
            {inputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>{deviceName(device, index, "input")}</option>
            ))}
          </Select>
        </Field>
        <Field label="Вывод звука">
          <Select
            value={preferences.outputDeviceId}
            onChange={(event) => change({ ...preferences, outputDeviceId: event.target.value })}
          >
            <option value="default">Системные динамики — автоматически</option>
            {outputs.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>{deviceName(device, index, "output")}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="audio-device-footer">
        <small role="status">{status}</small>
        <Button size="small" onClick={() => void refresh(true)}>Проверить и обновить</Button>
      </div>
    </section>
  );
}
