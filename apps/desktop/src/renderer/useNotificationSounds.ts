import { useEffect, useRef } from "react";
import type { NotificationPreferences, WorkspaceNotification } from "@yuksalish/contracts";
import { notificationSoundEnabled, playNotificationOnce, workspaceSounds } from "./workspace-sounds";

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
    for (const item of notifications) {
      if (known.current.ids.has(item.id)) continue;
      known.current.ids.add(item.id);
      const age = Date.now() - Date.parse(item.occurredAt);
      if (item.readAt || !Number.isFinite(age) || age < -5000 || age > 60_000 || !notificationSoundEnabled(item, prefs)) continue;
      void playNotificationOnce(userId, item.id, prefs.soundVolume ?? 20).catch(() => undefined);
    }
  }, [userId, notifications, prefs]);
}
