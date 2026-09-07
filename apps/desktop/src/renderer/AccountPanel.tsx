import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  InvitationResult,
  PasswordResetResult,
  SessionSummary,
  TotpSetup,
  WorkspacePerson,
  WorkspacePosition,
} from "@yuksalish/contracts";
import { Avatar, Button, Checkbox, Field, Input, Select } from "@fluentui/react-components";
import { useModalFocus } from "./useModalFocus";
import { AudioDeviceSettings } from "./AudioDeviceSettings";

import {
  confirmTotp,
  createInvitation,
  createPasswordReset,
  getTotpStatus,
  loadDirectory,
  loadSessions,
  revokeSession,
  setupTotp,
} from "./workspace-api";

interface AccountPanelProps {
  readonly initialSection?: "invite";
  readonly token: string;
  readonly user: WorkspacePerson;
  readonly onClose: () => void;
  readonly onLogout: () => void;
}

export function AccountPanel({ token, user, onClose, onLogout, initialSection }: AccountPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  useModalFocus(panelRef, true, onClose);
  const inviteRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialSection !== "invite") return;
    const frame = requestAnimationFrame(() => {
      inviteRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      inviteRef.current?.scrollIntoView?.({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
  const [totpActive, setTotpActive] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetup>();
  const [totpCode, setTotpCode] = useState("");
  const [invite, setInvite] = useState<InvitationResult>();
  const [inviteName, setInviteName] = useState("");
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "employee">("employee");
  const [invitePositionId, setInvitePositionId] = useState("");
  const [positions, setPositions] = useState<readonly WorkspacePosition[]>([]);
  const [reset, setReset] = useState<PasswordResetResult>();
  const [resetUsername, setResetUsername] = useState("");
  const [resetTotp, setResetTotp] = useState(false);
  const [feedback, setFeedback] = useState("");

  const refreshSecurity = async () => {
    const [totp, currentSessions] = await Promise.all([
      getTotpStatus(token),
      loadSessions(token),
    ]);
    setTotpActive(totp.enabled);
    setSessions(currentSessions);
  };

  useEffect(() => {
    let active = true;
    void Promise.all([getTotpStatus(token), loadSessions(token), loadDirectory(token)])
      .then(([totp, currentSessions, directory]) => {
        if (!active) return;
        setTotpActive(totp.enabled);
        setSessions(currentSessions);
        setPositions(directory.positions.filter((position) => position.isActive));
      })
      .catch((error: unknown) => {
        if (active) {
          setFeedback(error instanceof Error ? error.message : "Не удалось загрузить безопасность");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  const startTotp = async () => {
    try {
      setTotpSetup(await setupTotp(token));
      setFeedback("Добавьте секрет в приложение-аутентификатор и подтвердите код.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось включить TOTP");
    }
  };

  const finishTotp = async () => {
    try {
      await confirmTotp(token, totpCode);
      setTotpActive(true);
      setTotpSetup(undefined);
      setTotpCode("");
      setFeedback("Двухфакторная защита включена.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Неверный код");
    }
  };

  const submitInvitation = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const created = await createInvitation(token, {
        username: inviteUsername,
        fullName: inviteName,
        role: inviteRole,
        positionId: invitePositionId || undefined,
      });
      setInvite(created);
      setFeedback("Приглашение создано. Передайте код сотруднику безопасным каналом.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать приглашение");
    }
  };

  const removeSession = async (session: SessionSummary) => {
    await revokeSession(token, session.id);
    if (session.current) {
      onLogout();
      return;
    }
    await refreshSecurity();
  };

  const submitPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const created = await createPasswordReset(token, resetUsername, resetTotp);
      setReset(created);
      setFeedback("Код сброса создан. Передайте его сотруднику безопасным каналом.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать код сброса");
    }
  };

  return (
    <div className="account-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        className="account-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={initialSection === "invite" ? "Приглашение сотрудника" : "Безопасность аккаунта"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Настройки</span>
            <h2>{initialSection === "invite" ? "Пригласить сотрудника" : "Аккаунт и безопасность"}</h2>
          </div>
          <Button appearance="subtle" onClick={onClose}>Закрыть</Button>
        </header>

        {initialSection !== "invite" && <><section className="account-profile">
          <Avatar name={user.name} size={48} color="colorful" />
          <div>
            <strong>{user.name}</strong>
            <span>{user.jobTitle ?? user.role}</span>
            <small>@{user.username}</small>
          </div>
        </section>

        <AudioDeviceSettings />

        <section className="account-section">
          <div className="account-section-title">
            <div>
              <h3>Двухфакторная защита</h3>
              <p>Одноразовый шестизначный код при каждом новом входе.</p>
            </div>
            <span className={totpActive ? "security-ok" : "security-warning"}>
              {totpActive ? "Включена" : "Не включена"}
            </span>
          </div>
          {!totpActive && !totpSetup ? (
            <Button onClick={() => void startTotp()}>Настроить TOTP</Button>
          ) : null}
          {totpSetup ? (
            <div className="totp-setup">
              <p>Секрет для Google Authenticator, Microsoft Authenticator или 1Password:</p>
              <code>{totpSetup.secret}</code>
              <Field label="Код подтверждения">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(_, data) => setTotpCode(data.value.replace(/\D/g, ""))}
                />
              </Field>
              <Button appearance="primary" disabled={totpCode.length !== 6} onClick={() => void finishTotp()}>
                Подтвердить
              </Button>
            </div>
          ) : null}
        </section>

        <section className="account-section">
          <div className="account-section-title">
            <div>
              <h3>Активные устройства</h3>
              <p>Можно завершить любую сессию, включая текущую.</p>
            </div>
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <span>
                  <strong>{session.deviceLabel}</strong>
                  <small>{session.current ? "Текущее устройство" : new Date(session.lastSeenAt).toLocaleString("ru-RU")}</small>
                </span>
                <Button size="small" onClick={() => void removeSession(session)}>
                  {session.current ? "Выйти" : "Завершить"}
                </Button>
              </div>
            ))}
          </div>
        </section>

        </>}
        {["admin", "superadmin"].includes(user.role) ? (
          <>
            <section ref={inviteRef} className="account-section">
            <div className="account-section-title">
              <div>
                <h3>Пригласить сотрудника</h3>
                <p>Код действует 48 часов и принимается только один раз.</p>
              </div>
            </div>
            <form className="invite-form" onSubmit={submitInvitation}>
              <Field label="Имя сотрудника" required>
                <Input value={inviteName} onChange={(_, data) => setInviteName(data.value)} />
              </Field>
              <Field label="Логин" required>
                <Input value={inviteUsername} onChange={(_, data) => setInviteUsername(data.value)} />
              </Field>
              <Field label="Роль">
                <Select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}>
                  <option value="employee">Сотрудник</option>
                  <option value="manager">Руководитель</option>
                  <option value="admin">Администратор</option>
                </Select>
              </Field>
              <Field label="Должность">
                <Select
                  value={invitePositionId}
                  onChange={(event) => setInvitePositionId(event.target.value)}
                >
                  <option value="">Не назначена</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.name}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" appearance="primary" disabled={!inviteName || !inviteUsername}>
                Создать приглашение
              </Button>
            </form>
            {invite ? (
              <div className="invite-result">
                <strong>Одноразовый код для @{invite.username}</strong>
                <code>{invite.inviteToken}</code>
                <Button
                  size="small"
                  onClick={() => void navigator.clipboard.writeText(invite.inviteToken)}
                >
                  Копировать
                </Button>
              </div>
            ) : null}
            </section>

            {initialSection !== "invite" && <section className="account-section">
              <div className="account-section-title">
                <div>
                  <h3>Восстановить доступ</h3>
                  <p>Код действует 2 часа; после смены пароля все старые сессии закроются.</p>
                </div>
              </div>
              <form className="invite-form" onSubmit={submitPasswordReset}>
                <Field label="Логин сотрудника" required>
                  <Input
                    value={resetUsername}
                    onChange={(_, data) => setResetUsername(data.value)}
                  />
                </Field>
                <Checkbox
                  checked={resetTotp}
                  label="Также сбросить двухфакторную защиту"
                  onChange={(_, data) => setResetTotp(data.checked === true)}
                />
                <Button type="submit" appearance="primary" disabled={!resetUsername}>
                  Создать код сброса
                </Button>
              </form>
              {reset ? (
                <div className="invite-result">
                  <strong>Одноразовый код для @{reset.username}</strong>
                  <code>{reset.resetToken}</code>
                  <Button
                    size="small"
                    onClick={() => void navigator.clipboard.writeText(reset.resetToken)}
                  >
                    Копировать
                  </Button>
                </div>
              ) : null}
            </section>}
          </>
        ) : null}

        {feedback ? <div className="account-feedback" role="status">{feedback}</div> : null}
      </aside>
    </div>
  );
}
