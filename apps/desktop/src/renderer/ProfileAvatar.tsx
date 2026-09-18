import { Avatar } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { loadProfileAvatar } from "./workspace-api";

const avatarUrls = new Map<string, string>();

export function ProfileAvatar({ person, token, size }: {
  readonly person: WorkspacePerson;
  readonly token: string;
  readonly size: 24 | 28 | 32 | 36 | 40 | 48 | 56 | 64 | 72 | 96 | 120 | 128;
}) {
  if (!person.avatarVersion) return <Avatar name={person.name} size={size} color="colorful" />;
  const cacheKey = `${person.id}:${person.avatarVersion}`;
  return <LoadedProfileAvatar key={cacheKey} person={person} token={token} size={size} cacheKey={cacheKey} />;
}

function LoadedProfileAvatar({ person, token, size, cacheKey }: {
  readonly person: WorkspacePerson;
  readonly token: string;
  readonly size: 24 | 28 | 32 | 36 | 40 | 48 | 56 | 64 | 72 | 96 | 120 | 128;
  readonly cacheKey: string;
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
  return <Avatar name={person.name} size={size} color="colorful" image={url ? { src: url } : undefined} />;
}
