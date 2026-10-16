import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceAttachment } from "@yuksalish/contracts";
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
  VoiceMessagePlayer,
} from "./VoiceMessage";

const storageKey = "yuksalish.audio-devices.v1";
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

describe("compact voice player", () => {
  const attachment: WorkspaceAttachment = { id: "voice", ownerType: "message", ownerId: "message", fileName: "voice.webm", contentType: "audio/webm", byteSize: 29000,
    documentRole: "general", sha256: "a".repeat(64), uploadedByUserId: "aziza", mediaKind: "voice", mediaDurationMs: 22000, createdAt: "2026-10-15T09:00:00Z" };
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it("keeps duration, size and metadata in one details row and preserves playback/seek/volume", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:voice");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const onLoad = vi.fn().mockResolvedValue(new Blob(["voice"]));
    const { container, unmount } = render(<VoiceMessagePlayer attachment={attachment} onLoad={onLoad} metadata={<span className="message-meta">12:10</span>} />);
    expect(container.querySelector(".voice-player-details")).toHaveTextContent("0:22, 28 КБ12:10");
    expect(onLoad).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    const audio = screen.getByLabelText<HTMLAudioElement>("Голосовое сообщение");
    fireEvent.play(audio);
    fireEvent.change(screen.getByRole("slider", { name: "Позиция голосового сообщения" }), { target: { value: "5000" } });
    expect(audio.currentTime).toBe(5);
    expect(container.querySelector(".voice-player-time")).toHaveTextContent("0:05, 28 КБ");
    vi.spyOn(audio, "paused", "get").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(pause).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Громкость" }));
    fireEvent.change(screen.getByRole("slider", { name: "Уровень громкости" }), { target: { value: "35" } });
    expect(audio.volume).toBe(.35);
    fireEvent.ended(audio);
    expect(container.querySelector(".voice-player-time")).toHaveTextContent("0:22, 28 КБ");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:voice");
  });
  it("retains a visible load failure and lets the user retry explicitly", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retry");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const onLoad = vi.fn().mockRejectedValueOnce(new Error("Нет соединения")).mockResolvedValueOnce(new Blob(["voice"]));
    render(<VoiceMessagePlayer attachment={attachment} onLoad={onLoad} />);
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Нет соединения");
    fireEvent.click(screen.getByRole("button", { name: "Воспроизвести" }));
    await waitFor(() => expect(screen.getByLabelText("Голосовое сообщение")).toHaveAttribute("src", "blob:retry"));
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

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
