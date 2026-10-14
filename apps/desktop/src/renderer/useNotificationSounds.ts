import { useEffect, useRef } from "react";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { defaultNotificationVolume, notificationSoundEnabled, playNotificationOnce, workspaceSounds } from "./workspace-sounds";

export function useNotificationSounds(userId: string | undefined,
  notifications: readonly WorkspaceNotification[], prefs: NotificationPreferences): void {
  const known = useRef<{ userId: string; ids: Set<string> } | undefined>(undefined);
  useEffect(() => {
    document.addEventListener("pointerdown", workspaceSounds.unlock, { passive: true });
    document.addEventListener("keydown", workspaceSounds.unlock);
    return () => {
      document.removeEventListener("pointerdown", workspaceSounds.unlock);
      document.removeEventListener("keydown", workspaceSounds.unlock);
      workspaceSounds.stop();
    };
  }, []);
  useEffect(() => {
    if (!userId) { known.current = undefined; workspaceSounds.stop(); return; }
    if (known.current?.userId !== userId) {
      workspaceSounds.stop();
      known.current = { userId, ids: new Set(notifications.map(item => item.id)) };
      return; // Loaded history must never produce a choir after login/reload.
    }
    if (prefs.soundEnabled === false || prefs.soundVolume === 0) workspaceSounds.stop();
    const knownIds = known.current.ids;
    const fresh = notifications.filter(item => !knownIds.has(item.id));
    for (const item of fresh) knownIds.add(item.id);
    // Polling/reconnection can deliver a whole batch; never play its history.
    const item = fresh.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
    if (item) {
      const age = Date.now() - Date.parse(item.occurredAt);
      if (item.readAt || !Number.isFinite(age) || age < -5000 || age > 60_000 || !notificationSoundEnabled(item, prefs)) return;
      void playNotificationOnce(userId, item.id, prefs.soundVolume ?? defaultNotificationVolume).catch(() => undefined);
    }
  }, [userId, notifications, prefs]);
}
