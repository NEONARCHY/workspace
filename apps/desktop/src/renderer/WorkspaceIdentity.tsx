import { Avatar, Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { ChevronDown16Regular, Settings20Regular, SignOut20Regular } from "@fluentui/react-icons";
import type { WorkspacePerson } from "@yuksalish/contracts";

export function WorkspaceIdentity({ person, onSettings, onLogout }: { person: WorkspacePerson; onSettings: () => void; onLogout: () => void }) {
  return <Popover positioning="below-end" withArrow>
    <PopoverTrigger disableButtonEnhancement><button className="workspace-identity" type="button" aria-label={`Профиль: ${person.name}`}><Avatar name={person.name} size={32} color="colorful" /><span>{person.name}</span><ChevronDown16Regular /></button></PopoverTrigger>
    <PopoverSurface className="identity-popover"><Avatar name={person.name} size={48} color="colorful" /><h3>{person.name}</h3><p>{person.jobTitle ?? person.role}</p><Button appearance="subtle" icon={<Settings20Regular />} onClick={onSettings}>Настройки профиля</Button><Button appearance="subtle" icon={<SignOut20Regular />} onClick={onLogout}>Выйти</Button></PopoverSurface>
  </Popover>;
}

export function ConnectionIndicator({ detail, error }: { detail: string; error: boolean }) {
  return <Popover positioning="below-end" withArrow><PopoverTrigger disableButtonEnhancement><button type="button" className={`connection-indicator ${error ? "has-error" : ""}`} aria-label={`Подключение: ${detail}`}><i /><span>{detail}</span></button></PopoverTrigger><PopoverSurface className="connection-popover"><strong>Связь с рабочим сервером</strong><p>{detail}</p><small>Изменения появляются в рабочем пространстве после подтверждения сервером.</small></PopoverSurface></Popover>;
}
