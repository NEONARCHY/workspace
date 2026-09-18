import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAudioOutput,
  getAudioDevicePreferences,
  microphoneConstraints,
  resetAudioDevicePreference,
} from "./AudioDeviceSettings";
import {
  supportsCompressedVoiceRecording,
  VOICE_BITS_PER_SECOND,
  VOICE_MAX_DURATION_MS,
  VOICE_MIME_TYPE,
} from "./VoiceMessage";

const storageKey = "yuksalish.audio-devices.v1";
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

describe("voice message media policy", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (originalMediaDevices) Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
    else delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  });

  it("uses the Windows defaults until a device is explicitly selected", () => {
    expect(getAudioDevicePreferences()).toEqual({
      inputDeviceId: "default",
      outputDeviceId: "default",
    });
    expect(microphoneConstraints()).not.toHaveProperty("deviceId");
    localStorage.setItem(storageKey, JSON.stringify({
      inputDeviceId: "preferred-mic",
      outputDeviceId: "preferred-speakers",
    }));
    expect(microphoneConstraints()).toHaveProperty("deviceId", { exact: "preferred-mic" });
    expect(resetAudioDevicePreference("input")).toEqual({
      inputDeviceId: "default",
      outputDeviceId: "preferred-speakers",
    });
  });

  it("routes playback through the selected output when Chromium supports it", async () => {
    localStorage.setItem(storageKey, JSON.stringify({
      inputDeviceId: "default",
      outputDeviceId: "meeting-room",
    }));
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    await applyAudioOutput({ setSinkId } as unknown as HTMLMediaElement);
    expect(setSinkId).toHaveBeenCalledWith("meeting-room");
  });

  it("requires Opus and targets a compact voice size", () => {
    class SupportedRecorder {
      static isTypeSupported(type: string) {
        return type === VOICE_MIME_TYPE;
      }
    }
    vi.stubGlobal("MediaRecorder", SupportedRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    expect(supportsCompressedVoiceRecording()).toBe(true);
    expect(VOICE_BITS_PER_SECOND * 60 / 8).toBeLessThanOrEqual(240_000);
    expect(VOICE_MAX_DURATION_MS).toBe(600_000);
  });

  it("accepts Chromium WebM recording when the explicit codec alias is unavailable", () => {
    class SupportedRecorder {
      static isTypeSupported(type: string) {
        return type === "audio/webm";
      }
    }
    vi.stubGlobal("MediaRecorder", SupportedRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    expect(supportsCompressedVoiceRecording()).toBe(true);
  });
});
