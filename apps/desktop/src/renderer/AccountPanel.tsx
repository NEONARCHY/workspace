import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SlidingSegmented } from "./SlidingSegmented";

import type {
  DirectoryEmployee,
  InvitationResult,
  PasswordResetResult,
  SessionSummary,
  TotpSetup,
  WorkspacePerson,
  WorkspaceDepartment,
  WorkspacePosition,
  InterfaceLocale,
} from "@yuksalish/contracts";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import {
  ArrowSync24Regular,
  Camera24Regular,
  Desktop24Regular,
  Dismiss24Regular,
  Key24Regular,
  LocalLanguage24Regular,
  PersonAdd24Regular,
  PersonKey24Regular,
  ShieldLock24Regular,
  Speaker224Regular,
} from "@fluentui/react-icons";
import { useModalFocus } from "./useModalFocus";
import { AudioDeviceSettings } from "./AudioDeviceSettings";
import { DesktopUpdateSettings } from "./DesktopUpdateSettings";
import { WorkspaceSelect as Select } from "./WorkspaceSelect";
import { BirthdayDayPicker, birthdayMonthLength, birthdayMonthName } from "./BirthdayDayPicker";
import { ProfileAvatar } from "./ProfileAvatar";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { useContextMotion } from "./useContextMotion";

import {
  changeOwnPassword,
  changeUserPassword,
  confirmTotp,
  createInvitation,
  createPasswordReset,
  getTotpStatus,
  loadDirectory,
  loadBirthdayPreference,
  loadSessions,
  revokeSession,
  setupTotp,
  saveBirthdayPreference,
  uploadProfileAvatar,
} from "./workspace-api";

interface AccountPanelProps {
  readonly initialSection?: "invite";
  readonly token: string;
  readonly user: WorkspacePerson;
  readonly onClose: () => void;
  readonly onLogout: () => void;
  readonly onAvatarChanged?: (avatarVersion: string) => void;
  readonly locale?: InterfaceLocale;
  readonly onLocaleChange?: (locale: InterfaceLocale) => Promise<void>;
}

type AccountSectionKey = "profile" | "audio" | "security" | "sessions" | "invite" | "managed-password" | "recovery" | "updates";

interface AccountNavigationItem {
  readonly key: AccountSectionKey;
  readonly label: string;
  readonly icon: ReactNode;
  readonly admin?: boolean;
}

export function AccountPanel({ token, user, onClose, onLogout, onAvatarChanged, initialSection, locale = "ru", onLocaleChange }: AccountPanelProps) {
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
  const [departments, setDepartments] = useState<readonly WorkspaceDepartment[]>([]);
  const [managedScope, setManagedScope] = useState<EmployeeScope>("central");
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
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [birthdayBusy, setBirthdayBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<AccountSectionKey>(initialSection === "invite" ? "invite" : "profile");
  const contentRef = useContextMotion(activeSection);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityError, setSecurityError] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<SessionSummary>();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const jumpToSection = (sectionKey: AccountSectionKey) => {
    setActiveSection(sectionKey);
  };
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSection, contentRef]);

  const refreshSecurity = async () => {
    setSecurityLoading(true);
    setSecurityError("");
    try {
      const [totp, currentSessions] = await Promise.all([getTotpStatus(token), loadSessions(token)]);
      setTotpActive(totp.enabled);
      setSessions(currentSessions);
    } catch (error) {
      setSecurityError(error instanceof Error ? error.message : "Не удалось загрузить защиту и устройства.");
    } finally { setSecurityLoading(false); }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([getTotpStatus(token), loadSessions(token)])
      .then(([totp, currentSessions]) => {
        if (!active) return;
        setTotpActive(totp.enabled);
        setSessions(currentSessions);
      })
      .catch((error: unknown) => {
        if (active) setSecurityError(error instanceof Error ? error.message : "Не удалось загрузить защиту и устройства.");
      })
      .finally(() => { if (active) setSecurityLoading(false); });
    void loadDirectory(token).then((directory) => {
        if (!active) return;
        setPositions(directory.positions.filter((position) => position.isActive));
        setEmployees(directory.employees);
        setDepartments(directory.departments);
      })
      .catch((error: unknown) => {
        if (active) {
          setFeedback(error instanceof Error ? error.message : "Не удалось загрузить список сотрудников и должностей. Откройте настройки снова.");
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (initialSection === "invite") return;
    let active = true;
    void loadBirthdayPreference(token)
      .then((value) => {
        if (active) {
          setBirthdayMonth(value.month ? String(value.month) : "");
          setBirthdayDay(value.day ? String(value.day) : "");
        }
      })
      .catch(() => { if (active) setFeedback("Не удалось загрузить дату рождения. Попробуйте открыть настройки снова."); });
    return () => { active = false; };
  }, [initialSection, token]);

  const saveBirthday = async (clear = false) => {
    const month = clear ? null : Number(birthdayMonth);
    const day = clear ? null : Number(birthdayDay);
    if (!clear && (!month || !day)) { setFeedback("Выберите день и месяц рождения."); return; }
    setBirthdayBusy(true);
    try {
      const saved = await saveBirthdayPreference(token, { month, day });
      setBirthdayMonth(saved.month ? String(saved.month) : "");
      setBirthdayDay(saved.day ? String(saved.day) : "");
      setFeedback(clear ? "Дата рождения удалена." : "Дата рождения сохранена. Коллеги увидят поздравление в этот день.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось сохранить дату рождения.");
    } finally { setBirthdayBusy(false); }
  };

  const startTotp = async () => {
    if (operationBusy) return;
    setOperationBusy(true);
    try {
      setTotpSetup(await setupTotp(token));
      setFeedback("Добавьте секрет в приложение-аутентификатор и подтвердите код.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось включить TOTP");
    } finally { setOperationBusy(false); }
  };

  const finishTotp = async () => {
    if (operationBusy) return;
    setOperationBusy(true);
    try {
      await confirmTotp(token, totpCode);
      setTotpActive(true);
      setTotpSetup(undefined);
      setTotpCode("");
      setFeedback("Двухфакторная защита включена.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Неверный код");
    } finally { setOperationBusy(false); }
  };

  const submitInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (operationBusy) return;
    setOperationBusy(true);
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
    } finally { setOperationBusy(false); }
  };

  const removeSession = async (session: SessionSummary) => {
    if (operationBusy) return;
    setOperationBusy(true);
    try {
      await revokeSession(token, session.id);
      setSessionToRevoke(undefined);
      if (session.current) { onLogout(); return; }
      setSessions(current => current.filter(item => item.id !== session.id));
      setFeedback("Сеанс завершён. На этом устройстве потребуется войти снова.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось завершить сеанс. Попробуйте снова.");
    } finally { setOperationBusy(false); }
  };

  const submitPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    if (operationBusy) return;
    setOperationBusy(true);
    try {
      const created = await createPasswordReset(token, resetUsername, resetTotp);
      setReset(created);
      setFeedback("Код сброса создан. Передайте его сотруднику безопасным каналом.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Не удалось создать код сброса");
    } finally { setOperationBusy(false); }
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
    employeeScope(employee.departmentId, departments) === managedScope &&
    (user.role === "superadmin" || (user.role === "admin" && ["employee", "manager"].includes(employee.role))),
  );

  const copyAccessCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback("Код скопирован. Передайте его сотруднику безопасным каналом.");
    } catch {
      setFeedback("Не удалось скопировать код. Выделите его и скопируйте вручную.");
    }
  };

  const navigationItems: readonly AccountNavigationItem[] = [
    { key: "profile", label: "Личные данные", icon: <LocalLanguage24Regular /> },
    { key: "audio", label: "Звук", icon: <Speaker224Regular /> },
    { key: "security", label: "Защита и пароль", icon: <ShieldLock24Regular /> },
    { key: "sessions", label: "Устройства", icon: <Desktop24Regular /> },
    ...(["admin", "superadmin"].includes(user.role) ? [
      { key: "invite" as const, label: "Приглашения", icon: <PersonAdd24Regular />, admin: true },
      { key: "managed-password" as const, label: "Пароли сотрудников", icon: <PersonKey24Regular />, admin: true },
      { key: "recovery" as const, label: "Восстановление доступа", icon: <Key24Regular />, admin: true },
      { key: "updates" as const, label: "Обновления", icon: <ArrowSync24Regular />, admin: true },
    ] : []),
  ];

  return (
    <div className={`account-scrim account-profile-anchor account-settings-redesigned${initialSection === "invite" ? " account-invite-only" : ""}`} role="presentation" onMouseDown={onClose}>
      <aside
        className="account-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={initialSection === "invite" ? "Приглашение сотрудника" : "Настройки профиля"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="account-window-header">
          <div>
            <h2>{initialSection === "invite" ? "Пригласить сотрудника" : "Настройки профиля"}</h2>
            <p>{initialSection === "invite" ? "Создайте персональный доступ к Workspace" : "Личные данные, безопасность и ваши устройства"}</p>
          </div>
          <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть" onClick={onClose} />
        </header>

        {initialSection !== "invite" && <>
          <section className="account-profile">
            <EmployeeProfileLink as="div" userId={user.id} personName={user.name}>
              <ProfileAvatar person={user} token={token} size={48} />
            </EmployeeProfileLink>
            <EmployeeProfileLink as="div" userId={user.id} personName={user.name}>
              <div className="account-profile-copy">
                <strong>{user.name}</strong>
                <p>{user.jobTitle ?? user.role}</p>
                <small>@{user.username}</small>
              </div>
            </EmployeeProfileLink>
            <div className="account-profile-status" aria-label="Состояние аккаунта">
              <button type="button" onClick={() => jumpToSection("security")} className={totpActive ? "is-secure" : "needs-attention"}><ShieldLock24Regular />{securityLoading ? "Проверяем защиту…" : securityError ? "Защита: нет данных" : totpActive ? "Защита включена" : "Защита не включена"}</button>
              <button type="button" onClick={() => jumpToSection("sessions")}><Desktop24Regular />{securityLoading ? "Загрузка устройств…" : securityError ? "Устройства: нет данных" : `Устройств: ${sessions.length}`}</button>
            </div>
            <Button className="account-avatar-action" icon={<Camera24Regular />} disabled={avatarBusy} onClick={() => avatarInputRef.current?.click()}>{avatarBusy ? "Загрузка…" : "Сменить фото"}</Button>
              <input ref={avatarInputRef} hidden type="file" aria-label="Фото профиля" accept=".jpg,.jpeg,.png,.heic,.heif,.svg,image/jpeg,image/png,image/heic,image/heif,image/svg+xml" disabled={avatarBusy}
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
          </section>
        </>}

        <div className={`account-settings-layout${initialSection === "invite" ? " is-invite" : ""}`}>
        {initialSection !== "invite" && <>
          <SlidingSegmented as="nav" className="account-section-nav navigation-sliding" activeSelector=':scope > div > button[aria-pressed="true"]' aria-label="Разделы настроек">
            <span className="account-nav-group">Ваш аккаунт</span>
            {navigationItems.map((item, index) => <div key={item.key}>
              {item.admin && !navigationItems[index - 1]?.admin && <span className="account-nav-group">Администрирование</span>}
              <button
              key={item.key}
              type="button"
              className={activeSection === item.key ? "is-active" : ""}
              aria-pressed={activeSection === item.key}
              aria-controls={`account-page-${item.key}`}
              onClick={() => jumpToSection(item.key)}
            ><span aria-hidden="true">{item.icon}</span>{item.label}</button></div>)}
          </SlidingSegmented>
          <div className="account-compact-navigation">
            <Field label="Раздел настроек"><Select value={activeSection} onChange={event => jumpToSection(event.target.value as AccountSectionKey)}>
              {navigationItems.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </Select></Field>
          </div>
        </>}

        <div className="account-settings-content" ref={contentRef}>
        {initialSection !== "invite" && <>

        <div id="account-page-profile" className="account-settings-page" hidden={activeSection !== "profile"}>
        <div className="account-page-heading"><LocalLanguage24Regular /><div><h3>Личные данные</h3><p>Настройте Workspace под себя.</p></div></div>

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

        <section className="account-section" data-account-section="birthday">
          <div className="account-section-title"><div>
            <h3>День рождения</h3>
            <p>Сохраняем только день и месяц. В этот день организация поздравит вас в ленте, а коллеги получат уведомление.</p>
          </div></div>
          <div className="account-birthday-fields">
            <Field label="День">
              <BirthdayDayPicker month={birthdayMonth} day={birthdayDay} disabled={birthdayBusy} onChange={(month, day) => { setBirthdayMonth(month); setBirthdayDay(day); }} />
            </Field>
            <Field label="Месяц">
              <Select value={birthdayMonth} disabled={birthdayBusy} listboxClassName="birthday-month-list" onChange={(event) => { const next = event.target.value; setBirthdayMonth(next); if (birthdayDay && Number(birthdayDay) > birthdayMonthLength(Number(next))) setBirthdayDay(""); }}>
                <option value="">Выберите месяц</option>
                {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>
                  {birthdayMonthName(index + 1)}
                </option>)}
              </Select>
            </Field>
          </div>
          <div className="account-birthday-actions">
            <Button appearance="primary" disabled={birthdayBusy || !birthdayDay || !birthdayMonth}
              onClick={() => void saveBirthday()}>Сохранить дату</Button>
            <Button appearance="subtle" disabled={birthdayBusy || (!birthdayDay && !birthdayMonth)}
              onClick={() => void saveBirthday(true)}>Убрать дату</Button>
          </div>
          <p className="account-birthday-note">29 февраля в невисокосный год отмечается 28 февраля.</p>
        </section>
        </div>

        <div id="account-page-audio" className="account-settings-page" hidden={activeSection !== "audio"}><AudioDeviceSettings /></div>
        {["admin", "superadmin"].includes(user.role) && <div id="account-page-updates" className="account-settings-page" hidden={activeSection !== "updates"}><DesktopUpdateSettings token={token} canPublish={user.role === "superadmin"} /></div>}

        <div id="account-page-security" className="account-settings-page" hidden={activeSection !== "security"}>
        <section className="account-section" data-account-section="password">
          <div className="account-section-title">
            <div>
              <h3>Сменить свой пароль</h3>
              <p>После сохранения вы войдёте заново. Другие устройства также выйдут из аккаунта.</p>
            </div>
          </div>
          <form className="invite-form" onSubmit={(event) => void submitOwnPassword(event)}>
            <Field label="Новый пароль" required>
              <Input type="password" autoComplete="new-password" disabled={passwordBusy} value={ownPassword} onChange={(_, data) => setOwnPassword(data.value)} />
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
              {securityLoading ? "Загрузка…" : securityError ? "Нет данных" : totpActive ? "Включена" : "Не включена"}
            </span>
          </div>
          {!totpActive && !totpSetup ? (
            <Button disabled={operationBusy || securityLoading || !!securityError} onClick={() => void startTotp()}>{operationBusy ? "Подготовка…" : "Настроить TOTP"}</Button>
          ) : null}
          {totpSetup ? (
            <div className="totp-setup">
              <p>Секрет для Google Authenticator, Microsoft Authenticator или 1Password:</p>
              <code>{totpSetup.secret}</code>
              <Field label="Код подтверждения">
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  disabled={operationBusy}
                  value={totpCode}
                  onChange={(_, data) => setTotpCode(data.value.replace(/\D/g, ""))}
                />
              </Field>
              <Button appearance="primary" disabled={operationBusy || totpCode.length !== 6} onClick={() => void finishTotp()}>
                {operationBusy ? "Проверяем…" : "Подтвердить"}
              </Button>
            </div>
          ) : null}
        </section>
        {securityError && <div className="account-retry" role="alert"><p>{securityError}</p><Button disabled={securityLoading} onClick={() => void refreshSecurity()}>Повторить загрузку</Button></div>}
        </div>

        <div id="account-page-sessions" className="account-settings-page" hidden={activeSection !== "sessions"}>
        <section className="account-section" data-account-section="sessions">
          <div className="account-section-title">
            <div>
              <h3>Активные устройства</h3>
              <p>Здесь устройства, на которых выполнен вход. Завершение сеанса потребует войти заново.</p>
            </div>
          </div>
          <div className="session-list">
            {sessions.map((session) => (
              <div key={session.id}>
                <span>
                  <strong>{session.deviceLabel}</strong>
                  <small>{session.current ? "Текущее устройство" : new Date(session.lastSeenAt).toLocaleString("ru-RU")}</small>
                </span>
                <Button size="small" disabled={operationBusy || securityLoading || !!securityError} onClick={() => setSessionToRevoke(session)}>
                  {session.current ? "Выйти" : "Завершить"}
                </Button>
              </div>
            ))}
          </div>
          {securityLoading && <p role="status">Загружаем активные устройства…</p>}
          {!securityLoading && !securityError && sessions.length === 0 && <p className="account-empty-state">Нет доступных сведений об активных устройствах.</p>}
          {securityError && <div className="account-retry" role="alert"><p>{securityError}</p><Button disabled={securityLoading} onClick={() => void refreshSecurity()}>Повторить загрузку</Button></div>}
          {sessionToRevoke && <div className="account-session-confirm" role="group" aria-label="Подтверждение завершения сеанса">
            <strong>{sessionToRevoke.current ? "Выйти на этом устройстве?" : `Завершить сеанс «${sessionToRevoke.deviceLabel}»?`}</strong>
            <p>{sessionToRevoke.current ? "Вы вернётесь на экран входа." : "На выбранном устройстве потребуется войти снова. Остальные сеансы останутся открытыми."}</p>
            <div><Button appearance="primary" disabled={operationBusy} onClick={() => void removeSession(sessionToRevoke)}>{operationBusy ? "Завершаем…" : "Завершить сеанс"}</Button><Button disabled={operationBusy} onClick={() => setSessionToRevoke(undefined)}>Отмена</Button></div>
          </div>}
        </section>
        </div>

        </>}
        {["admin", "superadmin"].includes(user.role) ? (
          <>
            <div id="account-page-invite" className="account-settings-page" hidden={activeSection !== "invite"}>
            <section ref={inviteRef} className="account-section" data-account-section="invite">
            <div className="account-section-title">
              <div>
                {initialSection !== "invite" ? <h3>Пригласить сотрудника</h3> : null}
                <p>Код действует 48 часов и принимается только один раз.</p>
              </div>
            </div>
            <form className="invite-form" onSubmit={submitInvitation}>
              <Field label="Имя сотрудника" required>
                <Input autoComplete="off" disabled={operationBusy} value={inviteName} onChange={(_, data) => setInviteName(data.value)} />
              </Field>
              <Field label="Логин" required>
                <Input autoComplete="off" disabled={operationBusy} value={inviteUsername} onChange={(_, data) => setInviteUsername(data.value)} />
              </Field>
              <Field label="Роль">
                <Select value={inviteRole} disabled={operationBusy} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}>
                  <option value="employee">Сотрудник</option>
                  <option value="manager">Руководитель</option>
                  <option value="admin">Администратор</option>
                </Select>
              </Field>
              <Field label="Должность">
                <Select
                  value={invitePositionId}
                  disabled={operationBusy}
                  onChange={(event) => setInvitePositionId(event.target.value)}
                >
                  <option value="">Не назначена</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>{position.name}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" appearance="primary" disabled={operationBusy || !inviteName.trim() || !inviteUsername.trim()}>
                {operationBusy ? "Создаём…" : "Создать приглашение"}
              </Button>
            </form>
            {invite ? (
              <div className="invite-result">
                <strong>Одноразовый код для @{invite.username}</strong>
                <code>{invite.inviteToken}</code>
                <Button
                  size="small"
                  onClick={() => void copyAccessCode(invite.inviteToken)}
                >
                  Копировать
                </Button>
              </div>
            ) : null}
            </section>
            </div>

            {initialSection !== "invite" && <div id="account-page-managed-password" className="account-settings-page" hidden={activeSection !== "managed-password"}><section className="account-section" data-account-section="managed-password">
              <div className="account-section-title">
                <div>
                  <h3>Сменить пароль сотрудника</h3>
                  <p>Без кода сброса. После сохранения все устройства сотрудника выйдут из аккаунта.</p>
                </div>
              </div>
              <form className="invite-form" onSubmit={(event) => void submitManagedPassword(event)}>
                <EmployeeScopeSwitch value={managedScope} onChange={(next) => { setManagedScope(next); setManagedUserId(""); }} label="Группа сотрудников для смены пароля" disabled={passwordBusy} />
                <Field label="Сотрудник" required>
                  <Select value={managedUserId} disabled={passwordBusy} onChange={(event) => setManagedUserId(event.target.value)}>
                    <option value="">Выберите сотрудника</option>
                    {manageableEmployees.map((employee) => (
                      <option key={employee.id} value={employee.id}>{employee.name} (@{employee.username})</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Новый пароль" required>
                  <Input type="password" autoComplete="new-password" disabled={passwordBusy} value={managedPassword} onChange={(_, data) => setManagedPassword(data.value)} />
                </Field>
                <Button type="submit" appearance="primary" disabled={passwordBusy || !managedUserId || managedPassword.length < 12}>Сменить пароль</Button>
              </form>
              <p className="account-password-hint">Администратор может менять пароли сотрудников и руководителей; суперадминистратор — всех.</p>
            </section></div>}

            {initialSection !== "invite" && <div id="account-page-recovery" className="account-settings-page" hidden={activeSection !== "recovery"}><section className="account-section" data-account-section="recovery">
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
                    disabled={operationBusy}
                    autoComplete="off"
                    onChange={(_, data) => setResetUsername(data.value)}
                  />
                </Field>
                <Checkbox
                  checked={resetTotp}
                  disabled={operationBusy}
                  label="Также сбросить двухфакторную защиту"
                  onChange={(_, data) => setResetTotp(data.checked === true)}
                />
                <Button type="submit" appearance="primary" disabled={operationBusy || !resetUsername.trim()}>
                  {operationBusy ? "Создаём…" : "Создать код сброса"}
                </Button>
              </form>
              {reset ? (
                <div className="invite-result">
                  <strong>Одноразовый код для @{reset.username}</strong>
                  <code>{reset.resetToken}</code>
                  <Button
                    size="small"
                    onClick={() => void copyAccessCode(reset.resetToken)}
                  >
                    Копировать
                  </Button>
                </div>
              ) : null}
            </section></div>}
          </>
        ) : null}

        </div>
        </div>
        {feedback ? <div className="account-settings-feedback" role="status"><p>{feedback}</p><Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Скрыть сообщение" onClick={() => setFeedback("")} /></div> : null}
      </aside>
    </div>
  );
}
