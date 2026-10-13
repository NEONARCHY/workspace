import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAudioOutput,
  getAudioDevicePreferences,
  microphoneConstraints,
  resetAudioDevicePreference,
} from "./AudioDeviceSettings";
import {
  supportsCompressedVoiceRecording,
  supportedVoiceMimeType,
  voiceRecordingExtension,
  sendMessengerRecording,
  nextVoicePlaybackRate,
  VOICE_BITS_PER_SECOND,
  VOICE_MAX_DURATION_MS,
  VOICE_MIME_TYPE,
  VOICE_PLAYBACK_RATES,
} from "./VoiceMessage";

const storageKey = "yuksalish.audio-devices.v1";
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

describe("voice message media policy", () => {
  it("routes Safari MP4 as an audio file, never as an Opus voice", async () => {
    const audio = vi.fn().mockResolvedValue({ id: "audio" }), voice = vi.fn();
    const file = new File(["synthetic"], "voice.m4a", { type: "audio/mp4;codecs=mp4a.40.2" });
    expect(await sendMessengerRecording(file, 1200, audio, voice)).toEqual({ id: "audio" });
    expect(audio).toHaveBeenCalledWith(file);
    expect(voice).not.toHaveBeenCalled();
  });
  it("preserves the voice duration and rejection for WebM retry", async () => {
    const audio = vi.fn(), voice = vi.fn().mockRejectedValue(new Error("Upload failed"));
    const file = new File(["synthetic"], "voice.webm", { type: VOICE_MIME_TYPE });
    await expect(sendMessengerRecording(file, 1200, audio, voice)).rejects.toThrow("Upload failed");
    expect(voice).toHaveBeenCalledWith(file, 1200);
    expect(audio).not.toHaveBeenCalled();
  });
  it("permits MP4 in messenger while preserving Referent's WebM-only recording contract", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (type: string) => type === "audio/mp4" });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    expect(supportsCompressedVoiceRecording()).toBe(false);
    expect(supportsCompressedVoiceRecording(true)).toBe(true);
    expect(supportedVoiceMimeType(true)).toBe("audio/mp4");
    expect(voiceRecordingExtension("audio/mp4;codecs=mp4a.40.2")).toBe("m4a");
    expect(voiceRecordingExtension(VOICE_MIME_TYPE)).toBe("webm");
  });
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

  it("cycles through every supported voice playback speed", () => {
    expect(VOICE_PLAYBACK_RATES).toEqual([1, 1.5, 2, 2.5]);
    expect(nextVoicePlaybackRate(1)).toBe(1.5);
    expect(nextVoicePlaybackRate(1.5)).toBe(2);
    expect(nextVoicePlaybackRate(2)).toBe(2.5);
    expect(nextVoicePlaybackRate(2.5)).toBe(1);
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
