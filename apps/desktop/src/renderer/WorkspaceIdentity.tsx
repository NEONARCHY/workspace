import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ChevronDown16Regular, Settings20Regular, SignOut20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { ProfileAvatar } from "./ProfileAvatar";

export function WorkspaceIdentity({ person, token, onSettings, onLogout }: { person: WorkspacePerson; token: string; onSettings: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={(_event, data) => setOpen(data.open)} positioning="below-end" withArrow>
    <PopoverTrigger disableButtonEnhancement><button className="workspace-identity" type="button" aria-label={`Профиль: ${person.name}`}><ProfileAvatar person={person} token={token} size={32} /><span>{person.name}</span><ChevronDown16Regular /></button></PopoverTrigger>
    <PopoverSurface className={`identity-popover${open ? "" : " is-closed"}`}>
      {open ? <>
      <div className="identity-popover-profile"><ProfileAvatar person={person} token={token} size={48} /><span><h3>{person.name}</h3><p>{person.jobTitle ?? person.role}</p></span></div>
      <div className="identity-popover-actions">
        <Button appearance="subtle" icon={<Settings20Regular />} onClick={() => { setOpen(false); onSettings(); }}>Настройки профиля</Button>
        <Button className="identity-signout" appearance="subtle" icon={<SignOut20Regular />} onClick={() => { setOpen(false); onLogout(); }}>Выйти</Button>
      </div>
      </> : null}
    </PopoverSurface>
  </Popover>;
}

export function ConnectionIndicator({ detail, error }: { detail: string; error: boolean }) {
  return <Popover positioning="below-end" withArrow><PopoverTrigger disableButtonEnhancement><button type="button" className={`connection-indicator ${error ? "has-error" : ""}`} aria-label={`Подключение: ${detail}`}><i /><span>{detail}</span></button></PopoverTrigger><PopoverSurface className="connection-popover"><strong>Связь с рабочим сервером</strong><p>{detail}</p><small>Изменения появляются в рабочем пространстве после подтверждения сервером.</small></PopoverSurface></Popover>;
}
