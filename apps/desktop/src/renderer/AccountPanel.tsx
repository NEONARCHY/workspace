import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import type {
  DirectoryEmployee,
  InvitationResult,
  PasswordResetResult,
  SessionSummary,
  TotpSetup,
  WorkspacePerson,
  WorkspacePosition,
  InterfaceLocale,
} from "@yuksalish/contracts";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { Camera24Regular, Dismiss24Regular } from "@fluentui/react-icons";
import { useModalFocus } from "./useModalFocus";
import { AudioDeviceSettings } from "./AudioDeviceSettings";
import { DesktopUpdateSettings } from "./DesktopUpdateSettings";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeProfileLink } from "./EmployeeProfileLink";

import {
  changeOwnPassword,
  changeUserPassword,
  confirmTotp,
  createInvitation,
  createPasswordReset,
  getTotpStatus,
  loadDirectory,
  loadSessions,
  revokeSession,
  setupTotp,
  uploadProfileAvatar,
} from "./workspace-api";

interface AccountPanelProps {
  readonly anchor?: { readonly offsetRight: number; readonly originRight: number; readonly top: number };
  readonly initialSection?: "invite";
  readonly token: string;
  readonly user: WorkspacePerson;
  readonly onClose: () => void;
  readonly onLogout: () => void;
  readonly onAvatarChanged?: (avatarVersion: string) => void;
  readonly locale?: InterfaceLocale;
  readonly onLocaleChange?: (locale: InterfaceLocale) => Promise<void>;
}

export function AccountPanel({ token, user, onClose, onLogout, onAvatarChanged, initialSection, locale = "ru", onLocaleChange, anchor }: AccountPanelProps) {
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
  const [employees, setEmployees] = useState<readonly DirectoryEmployee[]>([]);
  const [ownPassword, setOwnPassword] = useState("");
  const [managedUserId, setManagedUserId] = useState("");
  const [managedPassword, setManagedPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [reset, setReset] = useState<PasswordResetResult>();
  const [resetUsername, setResetUsername] = useState("");
  const [resetTotp, setResetTotp] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const jumpToSection = (selector: string) => {
    const section = panelRef.current?.querySelector<HTMLElement>(selector);
    section?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    const heading = section?.querySelector<HTMLElement>("h3");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  };

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
        setEmployees(directory.employees);
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

  const submitOwnPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordBusy(true);
    try {
      await changeOwnPassword(token, ownPassword);
      setOwnPassword("");
      onLogout();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сменить пароль");
    } finally {
      setPasswordBusy(false);
    }
  };

  const submitManagedPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!managedUserId) return;
    setPasswordBusy(true);
    try {
      await changeUserPassword(token, managedUserId, managedPassword);
      setManagedPassword("");
      const employee = employees.find((item) => item.id === managedUserId);
      setFeedback(`Пароль ${employee?.name ?? "сотрудника"} изменён. Все его устройства выйдут из аккаунта.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сменить пароль");
    } finally {
      setPasswordBusy(false);
    }
  };

  const manageableEmployees = employees.filter((employee) =>
    employee.id !== user.id && employee.status === "active" &&
    (user.role === "superadmin" || (user.role === "admin" && ["employee", "manager"].includes(employee.role))),
  );

  const anchorStyle = anchor ? {
    "--account-anchor-top": `${anchor.top}px`,
    "--account-anchor-right": `${anchor.offsetRight}px`,
    "--account-origin-right": `${anchor.originRight}px`,
  } as CSSProperties : undefined;

  return (
    <div className="account-scrim account-profile-anchor" style={anchorStyle} role="presentation" onMouseDown={onClose}>
      <aside
        className="account-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={initialSection === "invite" ? "Приглашение сотрудника" : "Настройки профиля"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Настройки</span>
            <h2>{initialSection === "invite" ? "Пригласить сотрудника" : "Настройки профиля"}</h2>
          </div>
          <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть" onClick={onClose} />
        </header>

        {initialSection !== "invite" && <nav className="account-section-nav" aria-label="Разделы настроек">
          <button type="button" onClick={() => jumpToSection(".audio-device-settings")}>Звук</button>
          <button type="button" onClick={() => jumpToSection("[data-account-section=language]")}>Язык</button>
          <button type="button" onClick={() => jumpToSection("[data-account-section=security]")}>Защита</button>
          <button type="button" onClick={() => jumpToSection("[data-account-section=password]")}>Пароль</button>
          <button type="button" onClick={() => jumpToSection("[data-account-section=sessions]")}>Устройства</button>
          {["admin", "superadmin"].includes(user.role) && <button type="button" onClick={() => jumpToSection("[data-account-section=invite]")}>Доступ сотрудников</button>}
          {["admin", "superadmin"].includes(user.role) && <button type="button" onClick={() => jumpToSection("[data-account-section=managed-password]")}>Пароли сотрудников</button>}
          {["admin", "superadmin"].includes(user.role) && <button type="button" onClick={() => jumpToSection("[data-account-section=updates]")}>Обновления</button>}
        </nav>}

        {initialSection !== "invite" && <><section className="account-profile">
          <EmployeeProfileLink as="div" userId={user.id} personName={user.name}>
            <ProfileAvatar person={user} token={token} size={48} />
          </EmployeeProfileLink>
          <EmployeeProfileLink as="div" userId={user.id} personName={user.name}>
            <div>
              <strong>{user.name}</strong>
              <span>{user.jobTitle ?? user.role}</span>
              <small>@{user.username}</small>
            </div>
          </EmployeeProfileLink>
          <label className={`account-avatar-action fui-Button ${avatarBusy ? "is-busy" : ""}`}>
            <Camera24Regular />
            <span>{avatarBusy ? "Загрузка…" : "Сменить фото"}</span>
            <input hidden type="file" accept=".jpg,.jpeg,.png,.heic,.heif,.svg,image/jpeg,image/png,image/heic,image/heif,image/svg+xml" disabled={avatarBusy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setAvatarBusy(true);
                void uploadProfileAvatar(token, file).then((result) => {
                  onAvatarChanged?.(result.avatarVersion);
                  setFeedback("Аватар обновлён и сохранён на сервере.");
                }).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Не удалось загрузить аватар"))
                  .finally(() => setAvatarBusy(false));
              }} />
          </label>
        </section>

        <section className="account-section" data-account-section="language">
          <div className="account-section-title"><div>
            <h3>Язык интерфейса</h3>
            <p>Выберите язык интерфейса. Настройка сохранится для всех ваших устройств.</p>
          </div></div>
          <Field label="Язык">
            <Select value={locale} disabled={localeBusy} onChange={(event) => {
              const nextLocale = event.target.value as InterfaceLocale;
              setLocaleBusy(true);
              void (onLocaleChange?.(nextLocale) ?? Promise.resolve())
                .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : "Не удалось сменить язык"))
                .finally(() => setLocaleBusy(false));
            }}>
              <option value="ru">Русский</option>
              <option value="uz_cyrl">Ўзбекча</option>
              <option value="uz_latn">O‘zbekcha</option>
            </Select>
          </Field>
        </section>

        <AudioDeviceSettings />
        {["admin", "superadmin"].includes(user.role) && <DesktopUpdateSettings token={token} canPublish={user.role === "superadmin"} />}

        <section className="account-section" data-account-section="password">
          <div className="account-section-title">
            <div>
              <h3>Сменить свой пароль</h3>
              <p>После сохранения вы войдёте заново. Другие устройства также выйдут из аккаунта.</p>
            </div>
          </div>
          <form className="invite-form" onSubmit={(event) => void submitOwnPassword(event)}>
            <Field label="Новый пароль" required>
              <Input type="password" autoComplete="new-password" value={ownPassword} onChange={(_, data) => setOwnPassword(data.value)} />
            </Field>
            <Button type="submit" appearance="primary" disabled={passwordBusy || ownPassword.length < 12}>Сохранить новый пароль</Button>
          </form>
          <p className="account-password-hint">Не менее 12 символов: заглавные и строчные буквы, цифра и специальный знак.</p>
        </section>

        <section className="account-section" data-account-section="security">
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

        <section className="account-section" data-account-section="sessions">
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
            <section ref={inviteRef} className="account-section" data-account-section="invite">
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

            {initialSection !== "invite" && <section className="account-section" data-account-section="managed-password">
              <div className="account-section-title">
                <div>
                  <h3>Сменить пароль сотрудника</h3>
                  <p>Без кода сброса. После сохранения все устройства сотрудника выйдут из аккаунта.</p>
                </div>
              </div>
              <form className="invite-form" onSubmit={(event) => void submitManagedPassword(event)}>
                <Field label="Сотрудник" required>
                  <Select value={managedUserId} onChange={(event) => setManagedUserId(event.target.value)}>
                    <option value="">Выберите сотрудника</option>
                    {manageableEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name} (@{employee.username})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Новый пароль" required>
                  <Input type="password" autoComplete="new-password" value={managedPassword} onChange={(_, data) => setManagedPassword(data.value)} />
                </Field>
                <Button type="submit" appearance="primary" disabled={passwordBusy || !managedUserId || managedPassword.length < 12}>Сменить пароль</Button>
              </form>
              <p className="account-password-hint">Администратор может менять пароли сотрудников и руководителей; суперадминистратор — всех.</p>
            </section>}

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
