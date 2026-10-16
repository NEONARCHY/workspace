import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceRecorder, VOICE_MIME_TYPE } from "./VoiceMessage";

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
});

function microphoneFixture() {
  vi.stubGlobal("isSecureContext", true);
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const request = vi.fn<() => Promise<MediaStream>>();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: request } });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0, amplitude = 10;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  const closeContext = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class {
    createAnalyser() { return { fftSize: 256, smoothingTimeConstant: 0,
      getByteTimeDomainData(values: Uint8Array) { values.fill(128 + amplitude); } }; }
    createMediaStreamSource() { return { connect: vi.fn() }; }
    close = closeContext;
  });
  const start = vi.fn(), stop = vi.fn();
  const recorders: TestRecorder[] = [];
  class TestRecorder {
    static isTypeSupported(type: string) { return type === VOICE_MIME_TYPE; }
    state = "inactive";
    mimeType = VOICE_MIME_TYPE;
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { recorders.push(this); }
    start() { this.state = "recording"; start(); }
    stop() {
      this.state = "inactive"; stop();
      this.ondataavailable?.({ data: new Blob(["original voice"], { type: VOICE_MIME_TYPE }) } as BlobEvent);
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", TestRecorder);
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const frame = (time: number) => { const next = frames.entries().next().value!; frames.delete(next[0]); next[1](time); };
  return { stream, request, stopTrack, closeContext, start, stop, recorders, frames, now, frame, louder: () => { amplitude = 26; } };
}

it("does not flash connection UI and starts immediately when permission resolves", async () => {
  const f = microphoneFixture();
  let grant!: (stream: MediaStream) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const send = vi.fn().mockResolvedValue(true), close = vi.fn();
  const { container } = render(<VoiceRecorder onClose={close} onSend={send} />);
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText("Подключаем микрофон")).not.toBeInTheDocument();
  expect(f.start).not.toHaveBeenCalled();
  await act(async () => grant(f.stream));
  expect(f.start).toHaveBeenCalledOnce();
  expect(screen.getByText("Идёт запись")).toBeInTheDocument();
  const recorderPanel = screen.getByRole("region", { name: "Запись голосового сообщения" });
  expect(recorderPanel).toHaveClass("voice-recorder-recording");
  const wave = container.querySelector(".voice-recorder-live-waveform path")!;
  f.frame(100);
  const quiet = wave.getAttribute("d")!;
  expect(quiet).toMatch(/^M2 /);
  f.louder(); f.frame(200);
  expect(wave.getAttribute("d")).toContain("M7 ");
  expect(wave.getAttribute("d")).not.toBe(quiet);
  for (let index = 3; index <= 135; index++) f.frame(index * 100);
  expect(wave.getAttribute("d")!.match(/M/g)).toHaveLength(120);
  expect(wave.getAttribute("d")).toContain("M597 ");
  f.now.mockReturnValue(1500);
  fireEvent.click(screen.getByRole("button", { name: "Завершить" }));
  expect(f.stopTrack).toHaveBeenCalledOnce();
  expect(f.closeContext).toHaveBeenCalledOnce();
  expect(f.frames.size).toBe(0);
  expect(container.querySelector(".voice-recorder-live-waveform")).toBeNull();
  expect(screen.getByText("Запись готова")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Запись голосового сообщения" })).toBe(recorderPanel);
  expect(recorderPanel).toHaveClass("voice-recorder-ready");
  expect(recorderPanel.querySelector(".voice-preview")?.parentElement).toBe(recorderPanel);
  expect(screen.getByRole("button", { name: "Удалить запись" })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Отправить" })));
  expect(send).toHaveBeenCalledWith(expect.any(File), 1500);
  expect(close).toHaveBeenCalledOnce();
});

it("explains an actual microphone denial and keeps retry available without a connection banner", async () => {
  const f = microphoneFixture();
  f.request.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError")).mockResolvedValueOnce(f.stream);
  render(<VoiceRecorder onClose={vi.fn()} onSend={vi.fn()} />);
  expect(await screen.findByText(/Доступ к микрофону запрещён/)).toBeInTheDocument();
  expect(screen.queryByText("Подключаем микрофон")).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Повторить" })));
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Идёт запись")).toBeInTheDocument();
});

it("shows one remaining-time counter next to ready status and synchronizes playback, seek and end", async () => {
  const f = microphoneFixture();
  f.request.mockResolvedValueOnce(f.stream);
  const send = vi.fn().mockResolvedValue(true);
  const { container } = render(<VoiceRecorder onClose={vi.fn()} onSend={send} />);
  await act(async () => {});
  f.now.mockReturnValue(10000);
  fireEvent.click(screen.getByRole("button", { name: "Завершить" }));
  const counter = container.querySelector(".voice-recorder-state small")!;
  const audio = screen.getByLabelText<HTMLAudioElement>("Предпрослушивание голосового сообщения");
  expect(counter).toHaveTextContent("0:10");
  expect(container.querySelector(".voice-player-details")).toBeNull();
  fireEvent.play(audio);
  audio.currentTime = 3;
  fireEvent.timeUpdate(audio);
  expect(counter).toHaveTextContent("0:07");
  fireEvent.pause(audio);
  expect(counter).toHaveTextContent("0:07");
  fireEvent.change(screen.getByRole("slider", { name: "Позиция голосового сообщения" }), { target: { value: "6000" } });
  expect(audio.currentTime).toBe(6);
  expect(counter).toHaveTextContent("0:04");
  fireEvent.ended(audio);
  expect(counter).toHaveTextContent("0:10");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Отправить" })));
  expect(send).toHaveBeenCalledWith(expect.any(File), 10000);
});

it("releases a late permission grant after unmount without starting a recording", async () => {
  const f = microphoneFixture();
  let grant!: (stream: MediaStream) => void;
  f.request.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
  const view = render(<VoiceRecorder onClose={vi.fn()} onSend={vi.fn()} />);
  view.unmount();
  await act(async () => grant(f.stream));
  expect(f.stopTrack).toHaveBeenCalledOnce();
  expect(f.start).not.toHaveBeenCalled();
});

it("releases the microphone and analyser when recorder setup itself fails", async () => {
  const f = microphoneFixture();
  f.request.mockResolvedValueOnce(f.stream);
  class FailedRecorder {
    static isTypeSupported() { return true; }
    constructor() { throw new Error("Recorder unavailable"); }
  }
  vi.stubGlobal("MediaRecorder", FailedRecorder);
  render(<VoiceRecorder onClose={vi.fn()} onSend={vi.fn()} />);
  expect(await screen.findByText(/Микрофон недоступен/)).toBeInTheDocument();
  expect(f.stopTrack).toHaveBeenCalledOnce();
  expect(f.closeContext).toHaveBeenCalledOnce();
  expect(f.frames.size).toBe(0);
});
