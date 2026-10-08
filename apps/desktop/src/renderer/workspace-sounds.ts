import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import notificationUrl from "./assets/workspace-notification.mp3?url";

export function notificationSoundEnabled(item: WorkspaceNotification, prefs: NotificationPreferences): boolean {
  const channels = {
    message: prefs.messagesEnabled, task: prefs.tasksEnabled, approval: prefs.approvalsEnabled,
    trip: prefs.tripsEnabled, calendar: prefs.calendarEnabled, absence: prefs.absencesEnabled,
    zoom: prefs.zoomEnabled, hisobot: true, support: true, birthday: prefs.calendarEnabled,
    feed: prefs.feedEnabled !== false,
  };
  return prefs.soundEnabled !== false && (prefs.soundVolume ?? 20) > 0 && channels[item.kind]
    && (!item.isReminder || item.kind === "hisobot" || prefs.remindersEnabled);
}

export class WorkspaceSounds {
  private context?: AudioContext;
  private buffer?: Promise<AudioBuffer>;
  private playing?: { source: AudioBufferSourceNode; gain: GainNode };
  private lastNotification = -Infinity;
  private generation = 0;

  /** Invoke only from a genuine user gesture; browser autoplay restrictions remain intact. */
  unlock = (): void => {
    if (typeof AudioContext === "undefined") return;
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => undefined);
  };

  stop(): void {
    this.generation += 1;
    this.playing?.source.stop(); this.playing?.source.disconnect(); this.playing?.gain.disconnect();
    this.playing = undefined;
  }

  async notification(volume: number, preview = false): Promise<void> {
    const requestedGeneration = this.generation;
    if (!preview && (this.playing || Date.now() - this.lastNotification < 2500)) return;
    const context = this.context;
    if (!context || context.state !== "running") {
      if (preview) throw new Error("Браузер не разрешил звук. Нажмите «Проверить звук» ещё раз.");
      return;
    }
    this.buffer ??= fetch(notificationUrl).then(async response => {
      if (!response.ok) throw new Error("Не удалось загрузить звук уведомления");
      return context.decodeAudioData(await response.arrayBuffer());
    }).catch(error => { this.buffer = undefined; throw error; });
    const buffer = await this.buffer;
    if (this.generation !== requestedGeneration) return;
    if (!preview && (this.playing || Date.now() - this.lastNotification < 2500)) return;
    if (preview) this.stop();
    const source = context.createBufferSource(), gain = context.createGain();
    const level = Math.max(0, Math.min(100, volume)) / 100 * 0.65;
    const duration = buffer.duration;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(level, context.currentTime + Math.min(0.08, duration / 4));
    gain.gain.setValueAtTime(level, context.currentTime + Math.max(duration / 2, duration - 0.12));
    gain.gain.linearRampToValueAtTime(0, context.currentTime + duration);
    source.buffer = buffer; source.connect(gain); gain.connect(context.destination);
    this.playing = { source, gain }; this.lastNotification = Date.now();
    source.onended = () => { if (this.playing?.source === source) this.playing = undefined; source.disconnect(); gain.disconnect(); };
    source.start(); source.stop(context.currentTime + duration);
  }

  async preview(volume: number): Promise<void> {
    this.unlock();
    await this.context?.resume();
    await this.notification(volume, true);
  }
}

export const workspaceSounds = new WorkspaceSounds();

/** One bounded ID list and a lock prevent duplicate audio across tabs/reloads. */
export async function playNotificationOnce(userId: string, id: string, volume: number): Promise<void> {
  const key = `yuksalish:sound:${userId}`;
  const play = async () => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      const ids = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
      if (ids.includes(id)) return;
      localStorage.setItem(key, JSON.stringify([...ids.slice(-255), id]));
    } catch { /* Session-level IDs still deduplicate when storage is unavailable. */ }
    await workspaceSounds.notification(volume);
  };
  if (navigator.locks) await navigator.locks.request(key, play);
  else await play();
}
