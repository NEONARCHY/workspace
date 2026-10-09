import { Avatar } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { loadProfileAvatar } from "./workspace-api";

const avatarUrls = new Map<string, string>();
type AvatarPerson = Pick<WorkspacePerson, "id" | "name" | "avatarVersion">;
type AvatarSize = 16 | 20 | 24 | 28 | 32 | 36 | 40 | 48 | 56 | 64 | 72 | 96 | 120 | 128;
const avatarChangedEvent = "yuksalish:profile-avatar-changed";

export function notifyProfileAvatarChanged(userId: string, avatarVersion: string) {
  window.dispatchEvent(new CustomEvent(avatarChangedEvent, { detail: { userId, avatarVersion } }));
}

export function ProfileAvatar({ person, token, size, "aria-hidden": ariaHidden }: {
  readonly person: AvatarPerson;
  readonly token?: string;
  readonly size: AvatarSize;
  readonly "aria-hidden"?: boolean;
}) {
  const [changed, setChanged] = useState<{ userId: string; baseVersion: AvatarPerson["avatarVersion"]; version: string }>();
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; avatarVersion: string }>).detail;
      if (detail?.userId === person.id && typeof detail.avatarVersion === "string") {
        setChanged({ userId: person.id, baseVersion: person.avatarVersion, version: detail.avatarVersion });
      }
    };
    window.addEventListener(avatarChangedEvent, refresh);
    return () => window.removeEventListener(avatarChangedEvent, refresh);
  }, [person.id, person.avatarVersion]);
  const version = changed?.userId === person.id && changed.baseVersion === person.avatarVersion
    ? changed.version : person.avatarVersion;
  if (!version || !token) return <Avatar name={person.name} size={size} color="colorful" aria-hidden={ariaHidden} />;
  const cacheKey = `${person.id}:${version}`;
  return <LoadedProfileAvatar key={cacheKey} person={{ ...person, avatarVersion: version }} token={token} size={size} cacheKey={cacheKey} aria-hidden={ariaHidden} />;
}

function LoadedProfileAvatar({ person, token, size, cacheKey, "aria-hidden": ariaHidden }: {
  readonly person: AvatarPerson;
  readonly token: string;
  readonly size: AvatarSize;
  readonly cacheKey: string;
  readonly "aria-hidden"?: boolean;
}) {
  const [url, setUrl] = useState(() => avatarUrls.get(cacheKey));
  useEffect(() => {
    let active = true;
    if (url) return;
    void loadProfileAvatar(token, person.id, person.avatarVersion).then((blob) => {
      if (!active) return;
      const next = URL.createObjectURL(blob);
      avatarUrls.set(cacheKey, next);
      setUrl(next);
    }).catch(() => { if (active) setUrl(undefined); });
    return () => { active = false; };
  }, [cacheKey, person.avatarVersion, person.id, token, url]);
  return <Avatar name={person.name} size={size} color="colorful" image={url ? { src: url } : undefined} aria-hidden={ariaHidden} />;
}
