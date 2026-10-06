import type { ChatAvatarIconKey, ChatSummary, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar } from "@fluentui/react-components";
import { Building2, BriefcaseBusiness, CalendarDays, Compass, FileText, FolderKanban, Globe2, Plane, Sparkles, Star, Target, UsersRound } from "lucide-react";
import { ProfileAvatar } from "./ProfileAvatar";

export const chatAvatarOptions = [
  { key: "team", label: "Команда", icon: UsersRound },
  { key: "plane", label: "Самолёт", icon: Plane },
  { key: "project", label: "Проект", icon: FolderKanban },
  { key: "briefcase", label: "Портфель", icon: BriefcaseBusiness },
  { key: "building", label: "Организация", icon: Building2 },
  { key: "globe", label: "Мир", icon: Globe2 },
  { key: "calendar", label: "Календарь", icon: CalendarDays },
  { key: "document", label: "Документ", icon: FileText },
  { key: "target", label: "Цель", icon: Target },
  { key: "compass", label: "Направление", icon: Compass },
  { key: "star", label: "Звезда", icon: Star },
  { key: "sparkles", label: "Идея", icon: Sparkles },
] as const;

export function defaultChatIcon(chat: Pick<ChatSummary, "kind" | "contextType">): ChatAvatarIconKey {
  return chat.contextType === "trip" ? "plane" : chat.contextType === "project" || chat.kind === "project" ? "project" : "team";
}

export function ChatIcon({ iconKey, size = 40 }: { readonly iconKey: ChatAvatarIconKey; readonly size?: 40 | 56 }) {
  const Icon = chatAvatarOptions.find(option => option.key === iconKey)?.icon ?? UsersRound;
  return <span className={`chat-preset-avatar is-${iconKey}`} style={{ width: size, height: size }} aria-hidden="true">
    <Icon size={size === 56 ? 28 : 22} strokeWidth={1.8} />
  </span>;
}

export function ChatAvatar({ chat, currentUserId, people, token, size = 40 }: {
  readonly chat: ChatSummary; readonly currentUserId: string; readonly people: readonly WorkspacePerson[];
  readonly token: string; readonly size?: 40 | 56;
}) {
  if (chat.kind === "direct") {
    const peer = people.find(person => person.id !== currentUserId && chat.members.some(member => member.userId === person.id));
    return peer ? <ProfileAvatar person={peer} token={token} size={size} /> : <Avatar name={chat.title} size={size} color="colorful" />;
  }
  return <ChatIcon iconKey={chat.avatarIconKey ?? defaultChatIcon(chat)} size={size} />;
}

export function ChatIconPicker({ value, onChange, disabled = false }: {
  readonly value: ChatAvatarIconKey; readonly onChange: (key: ChatAvatarIconKey) => void; readonly disabled?: boolean;
}) {
  return <div className="chat-icon-picker" role="group" aria-label="Иконка чата">
    {chatAvatarOptions.map(({ key, label, icon: Icon }) => <button type="button" key={key} title={label}
      aria-label={`Иконка: ${label}`} aria-pressed={value === key} disabled={disabled} onClick={() => onChange(key)}>
      <Icon size={24} strokeWidth={1.8} aria-hidden="true" />
    </button>)}
  </div>;
}
