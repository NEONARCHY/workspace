import { useState } from "react";
import type {
  ChatMember,
  ChatPermissions,
  ChatSummary,
  CreateChatInput,
  WorkspacePerson,
} from "@yuksalish/contracts";
import {
  Button,
  Checkbox,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Textarea,
} from "@fluentui/react-components";
import { PeopleTeam24Regular, Sparkle24Regular } from "@fluentui/react-icons";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { ProfileAvatar } from "./ProfileAvatar";

export interface ChatActions {
  readonly create: (input: CreateChatInput) => Promise<ChatSummary>;
  readonly update: (
    id: string,
    title: string,
    description: string,
  ) => Promise<ChatSummary>;
  readonly add: (id: string, ids: readonly string[]) => Promise<ChatSummary>;
  readonly setMember: (id: string, member: ChatMember) => Promise<ChatSummary>;
  readonly remove: (id: string, userId: string) => Promise<void>;
  readonly transfer: (id: string, userId: string) => Promise<ChatSummary>;
  readonly delete: (id: string) => Promise<void>;
}

const permissionLabels: Record<keyof ChatPermissions, string> = {
  sendMessages: "Отправлять сообщения",
  uploadFiles: "Прикреплять файлы",
  inviteMembers: "Добавлять сотрудников",
  manageMembers: "Исключать участников",
  editInfo: "Менять название и описание",
  manageMessages: "Закреплять сообщения",
};
const adminPermissions: ChatPermissions = {
  sendMessages: true,
  uploadFiles: true,
  inviteMembers: true,
  manageMembers: true,
  editInfo: true,
  manageMessages: true,
};
const memberPermissions: ChatPermissions = {
  ...adminPermissions,
  inviteMembers: false,
  manageMembers: false,
  editInfo: false,
};
const roleLabels = {
  owner: "Владелец",
  moderator: "Администратор",
  member: "Участник",
};

function PeoplePicker({
  token,
  people,
  selected,
  onChange,
  single = false,
  disabled = false,
}: {
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly selected: readonly string[];
  readonly onChange: (ids: readonly string[]) => void;
  readonly single?: boolean;
  readonly disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const found = people.filter((person) =>
    `${person.name} ${person.jobTitle ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <div className="chat-people-picker">
      <Input
        aria-label="Найти сотрудника"
        placeholder="Имя или должность"
        value={query}
        onChange={(_, data) => setQuery(data.value)}
      />
      <div className="chat-people-options">
        {found.map((person) => (
          <Checkbox
            key={person.id}
            className="chat-person-option"
            aria-label={person.name}
            disabled={disabled}
            checked={selected.includes(person.id)}
            label={
              <span className="chat-person-identity">
                <ProfileAvatar person={person} token={token} size={36} />
                <span>
                  <strong>{person.name}</strong>
                  <small>{person.jobTitle || "Сотрудник"}</small>
                </span>
              </span>
            }
            onChange={(_, data) =>
              onChange(
                data.checked
                  ? single
                    ? [person.id]
                    : [...selected, person.id]
                  : selected.filter((id) => id !== person.id),
              )
            }
          />
        ))}
        {!found.length && <p className="muted">Сотрудники не найдены</p>}
      </div>
      <small>Выбрано: {selected.length}</small>
    </div>
  );
}

function MemberEditor({
  member,
  name,
  busy,
  onSave,
  onCancel,
}: {
  readonly member: ChatMember;
  readonly name: string;
  readonly busy: boolean;
  readonly onSave: (member: ChatMember) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(member);
  return (
    <div
      className="chat-member-editor"
      role="region"
      aria-label={`Права: ${name}`}
    >
      <Field label="Роль в группе">
        <Select
          value={draft.role}
          disabled={busy}
          onChange={(event) =>
            setDraft({
              ...draft,
              role: event.target.value as "moderator" | "member",
              permissions:
                event.target.value === "moderator"
                  ? adminPermissions
                  : memberPermissions,
            })
          }
        >
          <option value="member">Участник</option>
          <option value="moderator">Администратор</option>
        </Select>
      </Field>
      <p className="muted">
        Права действуют только в этой группе. Назначать роли и передавать
        владение может только владелец.
      </p>
      {(Object.keys(permissionLabels) as (keyof ChatPermissions)[]).map(
        (key) => (
          <Checkbox
            key={key}
            disabled={
              busy || (key === "uploadFiles" && !draft.permissions.sendMessages)
            }
            label={permissionLabels[key]}
            checked={draft.permissions[key]}
            onChange={(_, data) =>
              setDraft({
                ...draft,
                permissions: {
                  ...draft.permissions,
                  [key]: !!data.checked,
                  ...(key === "sendMessages" && !data.checked
                    ? { uploadFiles: false }
                    : {}),
                },
              })
            }
          />
        ),
      )}
      <div className="chat-dialog-actions">
        <Button
          appearance="primary"
          disabled={busy}
          onClick={() => onSave(draft)}
        >
          Сохранить права
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

export function ChatManagement({
  token,
  chat,
  currentUserId,
  people,
  actions,
  onClose,
  onCreated,
  onRequestDelete,
  allowDelete = false,
}: {
  readonly token: string;
  readonly chat?: ChatSummary;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly actions: ChatActions;
  readonly onClose: () => void;
  readonly onCreated: (chat: ChatSummary) => void;
  readonly onRequestDelete?: (chat: ChatSummary) => void;
  readonly allowDelete?: boolean;
}) {
  const [title, setTitle] = useState(chat?.title ?? "");
  const [description, setDescription] = useState(chat?.description ?? "");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [editing, setEditing] = useState<string>();
  const [confirmation, setConfirmation] = useState<{
    type: "remove" | "transfer";
    userId: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isOwner = chat?.ownerId === currentUserId;
  const isCreator = chat?.members.some((member) => member.userId === currentUserId && member.role === "owner");
  const isGroup = chat?.kind === "group";
  const isUserManagedChat = Boolean(chat && !chat.contextType && (chat.kind === "direct" || chat.kind === "group"));
  const personName = (id: string) =>
    people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const personFor = (id: string) => people.find((person) => person.id === id);
  const run = async (
    operation: () => Promise<unknown>,
    complete?: () => void,
  ) => {
    setBusy(true);
    setError("");
    try {
      await operation();
      complete?.();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить изменения",
      );
    } finally {
      setBusy(false);
    }
  };
  const eligible = people.filter(
    (person) =>
      person.id !== currentUserId &&
      !chat?.members.some((member) => member.userId === person.id),
  );
  return (
    <Dialog
      open
      onOpenChange={(_, data) => {
        if (!data.open && !busy) onClose();
      }}
    >
      <DialogSurface className="chat-settings-dialog">
        <DialogBody>
          <DialogTitle>
            {chat
              ? isGroup
                ? "Управление группой"
                : "Участники чата"
              : "Новая группа"}
          </DialogTitle>
          <DialogContent className="chat-settings-content">
            {error && (
              <p role="alert" className="inline-error">
                {error}
              </p>
            )}
            {!chat && (
              <div className="chat-create-intro">
                <span className="chat-create-icon" aria-hidden="true"><PeopleTeam24Regular /></span>
                <div>
                  <span className="chat-create-kicker"><Sparkle24Regular /> Новая команда</span>
                  <strong>Соберите рабочую группу</strong>
                  <p>Вы станете владельцем, а переписку увидят только выбранные сотрудники.</p>
                </div>
              </div>
            )}
            {(isGroup || !chat) && (
              <>
                <Field label="Название группы" required>
                  <Input
                    maxLength={240}
                    value={title}
                    disabled={busy || (!!chat && !chat.permissions.editInfo)}
                    onChange={(_, data) => setTitle(data.value)}
                  />
                </Field>
                <Field label="Описание группы">
                  <Textarea
                    maxLength={4000}
                    resize="vertical"
                    value={description}
                    disabled={busy || (!!chat && !chat.permissions.editInfo)}
                    onChange={(_, data) => setDescription(data.value)}
                  />
                </Field>
                {chat?.permissions.editInfo && (
                  <Button
                    disabled={busy || !title.trim()}
                    onClick={() =>
                      void run(() =>
                        actions.update(chat.id, title.trim(), description),
                      )
                    }
                  >
                    Сохранить описание
                  </Button>
                )}
              </>
            )}
            {chat && (
              <section
                className="chat-members-section"
                aria-label="Участники группы"
              >
                <h3>Участники · {chat.members.length}</h3>
                {chat.members.map((member) => (
                  <div className="chat-member" key={member.userId}>
                    <div className="chat-member-heading">
                      <EmployeeProfileLink userId={member.userId} personName={personName(member.userId)}>
                        {personFor(member.userId) ? (
                          <ProfileAvatar person={personFor(member.userId)!} token={token} size={32} />
                        ) : (
                          <span className="chat-member-avatar-fallback" aria-hidden="true" />
                        )}
                      </EmployeeProfileLink>
                      <EmployeeProfileLink userId={member.userId} personName={personName(member.userId)}>
                      <div>
                        <strong>{personName(member.userId)}</strong>
                        <small>
                          {roleLabels[member.role]}
                          {member.permissions.sendMessages
                            ? ""
                            : " · Только чтение"}
                        </small>
                      </div>
                      </EmployeeProfileLink>
                      <div className="chat-member-actions">
                        {isGroup &&
                          isOwner &&
                          member.userId !== currentUserId && (
                            <Button
                              size="small"
                              disabled={busy}
                              aria-label={`Права: ${personName(member.userId)}`}
                              onClick={() => setEditing(member.userId)}
                            >
                              Права
                            </Button>
                          )}
                        {isGroup &&
                          member.role !== "owner" &&
                          (member.userId === currentUserId ||
                            (chat.permissions.manageMembers &&
                              (member.role === "member" || isOwner))) && (
                            <Button
                              size="small"
                              disabled={busy}
                              onClick={() =>
                                setConfirmation({
                                  type: "remove",
                                  userId: member.userId,
                                })
                              }
                            >
                              {member.userId === currentUserId
                                ? "Выйти"
                                : "Исключить"}
                            </Button>
                          )}
                      </div>
                    </div>
                    {editing === member.userId && isOwner && (
                      <>
                        <MemberEditor
                          key={JSON.stringify(member)}
                          member={member}
                          name={personName(member.userId)}
                          busy={busy}
                          onCancel={() => setEditing(undefined)}
                          onSave={(updated) =>
                            void run(
                              () => actions.setMember(chat.id, updated),
                              () => setEditing(undefined),
                            )
                          }
                        />
                        <Button
                          appearance="subtle"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              type: "transfer",
                              userId: member.userId,
                            })
                          }
                        >
                          Передать владение группой
                        </Button>
                      </>
                    )}
                  </div>
                ))}
                {isOwner && (
                  <p className="muted">
                    Для выхода сначала передайте владение другому участнику
                    через «Права».
                  </p>
                )}
              </section>
            )}
            {(!chat || (isGroup && chat.permissions.inviteMembers)) && (
              <section>
                <h3>{chat ? "Добавить сотрудников" : "Сотрудники"}</h3>
                <PeoplePicker
                  token={token}
                  people={eligible}
                  selected={selected}
                  onChange={setSelected}
                  disabled={busy}
                />
                <p className="muted">
                  Добавленные участники увидят всю историю группы. Внешние гости
                  пока не поддерживаются.
                </p>
                {chat && (
                  <Button
                    disabled={busy || !selected.length}
                    onClick={() =>
                      void run(
                        () => actions.add(chat.id, selected),
                        () => setSelected([]),
                      )
                    }
                  >
                    Добавить выбранных
                  </Button>
                )}
              </section>
            )}
            {confirmation && chat && (
              <div className="chat-confirmation" role="alert">
                <p>
                  {confirmation.type === "transfer"
                    ? `Передать владение сотруднику ${personName(confirmation.userId)}? Вы станете администратором и больше не сможете назначать права.`
                    : `${personName(confirmation.userId)} потеряет доступ к переписке и файлам группы. Продолжить?`}
                </p>
                <Button
                  disabled={busy}
                  appearance="primary"
                  onClick={() =>
                    void run(
                      () =>
                        confirmation.type === "transfer"
                          ? actions.transfer(chat.id, confirmation.userId)
                          : actions.remove(chat.id, confirmation.userId),
                      () => {
                        if (
                          confirmation.type === "remove" &&
                          confirmation.userId === currentUserId
                        )
                          onClose();
                        setConfirmation(undefined);
                      },
                    )
                  }
                >
                  Подтвердить
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  Отмена
                </Button>
              </div>
            )}
            <div className="chat-dialog-actions">
              {chat && isUserManagedChat && onRequestDelete && (allowDelete || isOwner || isCreator) ? (
                <Button appearance="primary" disabled={busy} onClick={() => onRequestDelete(chat)}>
                  Удалить чат
                </Button>
              ) : null}
              {!chat && (
                <Button
                  appearance="primary"
                  disabled={
                    busy ||
                    !selected.length ||
                    !title.trim()
                  }
                  onClick={() =>
                    void run(async () => {
                      const created = await actions.create({
                        kind: "group",
                        title: title.trim(),
                        description,
                        memberIds: selected,
                      });
                      onCreated(created);
                    })
                  }
                >
                  {busy ? "Создаём…" : "Создать группу"}
                </Button>
              )}
              <Button disabled={busy} onClick={onClose}>
                Закрыть
              </Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
