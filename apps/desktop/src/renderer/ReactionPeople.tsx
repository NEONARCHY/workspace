import { useEffect } from "react";
import type { MessageReaction, WorkspacePerson } from "@yuksalish/contracts";
import { EmployeeProfileLink, useOpenEmployeeProfile } from "./EmployeeProfileLink";
import { ProfileAvatar } from "./ProfileAvatar";
import { MessageContextMenu, menuPortalContainerFor } from "./MessageContextMenu";

export function ReactionPeople({ reactions, people, token, onOpenPersonProfile }: {
  readonly reactions: readonly MessageReaction[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onOpenPersonProfile?: (userId: string) => void;
}) {
  const entries = reactions.flatMap((reaction) => (reaction.reactorUserIds ?? []).map((userId) => ({ userId, emoji: reaction.emoji })));
  return <div className="message-reaction-people">
    {entries.length ? entries.map(({ userId, emoji }) => {
      const person = people.find((item) => item.id === userId);
      const content = <>
        {person ? <ProfileAvatar person={person} token={token} size={28} /> : <span className="message-reaction-person-fallback" aria-hidden="true">?</span>}
        <span className="message-reaction-person-name">{person?.name ?? "Сотрудник"}</span><span aria-label={`Реакция ${emoji}`}>{emoji}</span>
      </>;
      return person && onOpenPersonProfile
        ? <button className="message-reaction-person" key={`${userId}-${emoji}`} type="button" onClick={() => onOpenPersonProfile(person.id)}>{content}</button>
        : <EmployeeProfileLink className="message-reaction-person" as="div" key={`${userId}-${emoji}`} userId={person?.id} personName={person?.name ?? "Сотрудник"}>{content}</EmployeeProfileLink>;
    }) : <p>{reactions.reduce((total, reaction) => total + reaction.count, 0)} реакций · список сотрудников недоступен</p>}
  </div>;
}

export interface ReactionDetailsTarget {
  readonly emoji: string;
  readonly x: number;
  readonly y: number;
  readonly anchor: HTMLButtonElement;
}

export function ReactionDetailsMenu({ target, reactions, people, token, onClose, onOpenPersonProfile }: {
  readonly target: ReactionDetailsTarget;
  readonly reactions: readonly MessageReaction[];
  readonly people: readonly WorkspacePerson[];
  readonly token: string;
  readonly onClose: () => void;
  readonly onOpenPersonProfile?: (userId: string) => void;
}) {
  const openProfileFromContext = useOpenEmployeeProfile();
  const openProfile = onOpenPersonProfile ?? openProfileFromContext;
  useEffect(() => {
    const close = () => onClose();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      target.anchor.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    // Handle Escape before a containing dialog so it closes only this menu.
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", escape, true);
    };
  }, [onClose, target.anchor]);
  return <MessageContextMenu x={target.x} y={target.y} portalContainer={menuPortalContainerFor(target.anchor)}
    label="Кто поставил реакцию" onPointerDown={(event) => event.stopPropagation()}>
    <strong className="message-reaction-quick-title">{target.emoji} · Поставили реакцию</strong>
    <ReactionPeople reactions={reactions.filter((reaction) => reaction.emoji === target.emoji)} people={people} token={token}
      onOpenPersonProfile={openProfile ? (id) => { onClose(); openProfile(id); } : undefined} />
  </MessageContextMenu>;
}
