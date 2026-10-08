import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { notificationSoundEnabled, playNotificationOnce, WorkspaceSounds, workspaceSounds } from "./workspace-sounds";

const prefs: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true,
  tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const item: WorkspaceNotification = { id: "event", kind: "feed", priority: "normal", title: "Новости", body: "Объявление", section: "feed",
  requiresAction: false, isReminder: false, occurredAt: new Date().toISOString() };
const source = () => ({ connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), buffer: null, onended: null });
const ramp = vi.fn(), gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: ramp }, connect: vi.fn(), disconnect: vi.fn() };
let sources: ReturnType<typeof source>[];
const decode = vi.fn();
beforeEach(() => {
  sources = []; localStorage.clear(); decode.mockResolvedValue({ duration: 1.7 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  vi.stubGlobal("AudioContext", class {
    state = "running"; currentTime = 10; destination = {};
    resume = async () => undefined;
    decodeAudioData = decode;
    createBufferSource = () => { const next = source(); sources.push(next); return next; };
    createGain = () => gain;
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("honors feed, global audio, volume and reminder switches independently", () => {
  expect(notificationSoundEnabled(item, { ...prefs, desktopEnabled: false })).toBe(true);
  expect(notificationSoundEnabled(item, { ...prefs, feedEnabled: false })).toBe(false);
  expect(notificationSoundEnabled(item, { ...prefs, soundEnabled: false })).toBe(false);
  expect(notificationSoundEnabled(item, { ...prefs, soundVolume: 0 })).toBe(false);
  expect(notificationSoundEnabled({ ...item, kind: "task", isReminder: true }, { ...prefs, remindersEnabled: false })).toBe(false);
});
it("plays the whole clip with soft gain and does not overlap a burst", async () => {
  const sounds = new WorkspaceSounds(); sounds.unlock();
  await Promise.all([sounds.notification(20), sounds.notification(20)]);
  expect(sources).toHaveLength(1);
  expect(ramp).toHaveBeenCalledWith(0.13, 10.08);
  expect(ramp).toHaveBeenCalledWith(0, 11.7);
  expect(sources[0]!.stop).toHaveBeenCalledWith(11.7);
  await sounds.notification(20);
  expect(sources).toHaveLength(1);
  sounds.stop();
  expect(sources[0]!.disconnect).toHaveBeenCalled();
});
it("keeps expired Hisobot reminders silent while allowing a dated missed-report notice", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T04:00:00Z"));
  const report = { ...item, kind: "hisobot" as const, occurredAt: "2026-10-08T13:25:00Z" };
  expect(notificationSoundEnabled({ ...report, isReminder: true }, prefs)).toBe(false);
  expect(notificationSoundEnabled(report, prefs)).toBe(true);
  expect(notificationSoundEnabled({ ...report, resolvedAt: "2026-10-08T13:30:00Z" }, prefs)).toBe(false);
});
it("cannot start pending audio after mute or logout", async () => {
  let resolve!: (buffer: { duration: number }) => void;
  decode.mockImplementation(() => new Promise(done => { resolve = done; }));
  const sounds = new WorkspaceSounds(); sounds.unlock();
  const pending = sounds.notification(20);
  await vi.waitFor(() => expect(decode).toHaveBeenCalled());
  sounds.stop(); resolve({ duration: 1 }); await pending;
  expect(sources).toHaveLength(0);
});
it("reports failed previews, then allows a retry", async () => {
  const sounds = new WorkspaceSounds(); sounds.unlock();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  await expect(sounds.preview(20)).rejects.toThrow("Не удалось загрузить звук");
  await sounds.preview(20);
  expect(sources).toHaveLength(1);
});
it("deduplicates sound across reloads and bounds stored IDs", async () => {
  const play = vi.spyOn(workspaceSounds, "notification").mockResolvedValue();
  localStorage.setItem("yuksalish:sound:user", JSON.stringify(Array.from({ length: 300 }, (_, i) => `${i}`)));
  await playNotificationOnce("user", "fresh", 20);
  await playNotificationOnce("user", "fresh", 20);
  expect(play).toHaveBeenCalledOnce();
  const ids = JSON.parse(localStorage.getItem("yuksalish:sound:user")!) as string[];
  expect(ids).toHaveLength(256); expect(ids.at(-1)).toBe("fresh");
});
