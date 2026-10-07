import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { AccountPanel } from "./AccountPanel";

const api = vi.hoisted(() => ({
  changeOwnPassword: vi.fn(),
  changeUserPassword: vi.fn(),
  createInvitation: vi.fn(),
  createPasswordReset: vi.fn(),
  setupTotp: vi.fn(),
  confirmTotp: vi.fn(),
  revokeSession: vi.fn(),
  getTotpStatus: vi.fn().mockResolvedValue({ enabled: false }),
  loadBirthdayPreference: vi.fn().mockResolvedValue({ month: null, day: null }),
  saveBirthdayPreference: vi.fn(),
  loadSessions: vi.fn().mockResolvedValue([]),
  loadDirectory: vi.fn().mockResolvedValue({
    positions: [],
    departments: [],
    employees: [
      { id: "employee-1", username: "employee", name: "Сотрудник", role: "employee", status: "active" },
      { id: "admin-2", username: "otheradmin", name: "Другой администратор", role: "admin", status: "active" },
    ],
  }),
  loadDesktopUpdatePolicy: vi.fn().mockResolvedValue({ publishedVersion: null, minimumVersion: null, mandatory: false, updatedAt: null, release: null }),
  loadDesktopReleases: vi.fn().mockResolvedValue([]),
  publishDesktopRelease: vi.fn(),
  setMandatoryDesktopUpdate: vi.fn(),
  stageDesktopRelease: vi.fn(),
  uploadProfileAvatar: vi.fn(),
  loadProfileAvatar: vi.fn(),
}));

vi.mock("./workspace-api", () => api);
vi.mock("./AudioDeviceSettings", () => ({ AudioDeviceSettings: () => null }));

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  api.changeOwnPassword.mockReset();
  api.changeUserPassword.mockReset();
  api.loadSessions.mockResolvedValue([]);
  api.getTotpStatus.mockResolvedValue({ enabled: false });
  api.revokeSession.mockReset();
  api.createInvitation.mockReset();
  api.createPasswordReset.mockReset();
  api.setupTotp.mockReset();
  api.confirmTotp.mockReset();
});

it("opens settings as a full profile-sized dialog and closes without a transition", () => {
  const onClose = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <AccountPanel token="test-token"
        user={{ id: "admin-1", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "#0091a8" }}
        onClose={onClose} onLogout={vi.fn()} />
    </FluentProvider>,
  );

  const scrim = document.querySelector(".account-profile-anchor");
  expect(scrim).not.toHaveClass("is-opening");
  expect(scrim).not.toHaveClass("is-closing");
  expect(screen.getByRole("dialog", { name: "Настройки профиля" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Разделы настроек" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("shows only the selected section, without scrolling anchors or duplicate title", () => {
  renderPanel();
  const navigation = screen.getByRole("navigation", { name: "Разделы настроек" });
  expect(screen.queryByText("Настройки", { exact: true })).not.toBeInTheDocument();
  expect(document.getElementById("account-page-profile")).not.toHaveAttribute("hidden");
  expect(document.getElementById("account-page-security")).toHaveAttribute("hidden");
  fireEvent.click(within(navigation).getByRole("button", { name: "Защита и пароль" }));
  expect(document.getElementById("account-page-profile")).toHaveAttribute("hidden");
  expect(document.getElementById("account-page-security")).not.toHaveAttribute("hidden");
  expect(within(navigation).getByRole("button", { name: "Защита и пароль" })).toHaveAttribute("aria-pressed", "true");
});

it("uploads a profile avatar and reports the new server version", async () => {
  api.uploadProfileAvatar.mockResolvedValue({ avatarVersion: "2026-09-19T12:00:00Z" });
  const onAvatarChanged = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <AccountPanel token="test-token"
        user={{ id: "admin-1", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "#0091a8" }}
        onClose={vi.fn()} onLogout={vi.fn()} onAvatarChanged={onAvatarChanged} />
    </FluentProvider>,
  );
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Фото профиля"]');
  if (!input) throw new Error("Avatar input was not rendered");
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "avatar.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(api.uploadProfileAvatar).toHaveBeenCalledWith("test-token", file));
  expect(onAvatarChanged).toHaveBeenCalledWith("2026-09-19T12:00:00Z");
});

it("offers appearance settings to ordinary employees and persists their sidebar choice", () => {
  render(<FluentProvider theme={webLightTheme}>
    <AccountPanel token="test-token"
      user={{ id: "appearance-employee", username: "employee", name: "Сотрудник", initials: "С", role: "employee", color: "#0091a8" }}
      onClose={vi.fn()} onLogout={vi.fn()} />
  </FluentProvider>);
  const navigation = screen.getByRole("navigation", { name: "Разделы настроек" });
  fireEvent.click(within(navigation).getByRole("button", { name: "Оформление" }));
  expect(document.getElementById("account-page-appearance")).not.toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Светлый" }));
  expect(localStorage.getItem("yuksalish:sidebar-theme:appearance-employee")).toBe("light");
  fireEvent.click(within(navigation).getByRole("button", { name: "Личные данные" }));
  fireEvent.click(within(navigation).getByRole("button", { name: "Оформление" }));
  expect(screen.getByRole("button", { name: "Светлый" })).toHaveAttribute("aria-pressed", "true");
  localStorage.removeItem("yuksalish:sidebar-theme:appearance-employee");
});

function renderPanel(onLogout = vi.fn()) {
  render(
    <FluentProvider theme={webLightTheme}>
      <AccountPanel
        token="test-token"
        user={{ id: "admin-1", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "#0091a8" }}
        onClose={vi.fn()}
        onLogout={onLogout}
      />
    </FluentProvider>,
  );
}

it("changes own password without an old-password field and signs out", async () => {
  api.changeOwnPassword.mockResolvedValue(undefined);
  const onLogout = vi.fn();
  renderPanel(onLogout);
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  const ownField = document.querySelector<HTMLInputElement>(
    '[data-account-section="password"] input[type="password"]',
  );
  if (!ownField) throw new Error("Own password field was not rendered");
  fireEvent.change(ownField, {
    target: { value: "Secure-New-Password-2026!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить новый пароль" }));
  await waitFor(() => expect(api.changeOwnPassword).toHaveBeenCalledWith(
    "test-token", "Secure-New-Password-2026!",
  ));
  expect(onLogout).toHaveBeenCalledOnce();
});

it("keeps the entered password and session after a server error", async () => {
  api.changeOwnPassword.mockRejectedValue(new Error("Сервер недоступен"));
  const onLogout = vi.fn();
  renderPanel(onLogout);
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  const ownField = document.querySelector<HTMLInputElement>(
    '[data-account-section="password"] input[type="password"]',
  );
  if (!ownField) throw new Error("Own password field was not rendered");
  fireEvent.change(ownField, { target: { value: "Secure-New-Password-2026!" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить новый пароль" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Сервер недоступен"));
  expect(ownField.value).toBe("Secure-New-Password-2026!");
  expect(onLogout).not.toHaveBeenCalled();
});

it("lets an admin change an employee password but does not list peer admins", async () => {
  api.changeUserPassword.mockResolvedValue(undefined);
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Пароли сотрудников" }));
  const employeeSelect = await screen.findByRole("combobox", { name: "Сотрудник" });
  expect(employeeSelect).toHaveTextContent("Выберите сотрудника");
  expect(employeeSelect).not.toHaveTextContent("Другой администратор");
  fireEvent.change(employeeSelect, { target: { value: "employee-1" } });
  await waitFor(() => expect(employeeSelect).toHaveTextContent("Сотрудник (@employee)"));
  const managedField = document.querySelector<HTMLInputElement>(
    '[data-account-section="managed-password"] input[type="password"]',
  );
  if (!managedField) throw new Error("Managed password field was not rendered");
  fireEvent.change(managedField, {
    target: { value: "Secure-New-Password-2026!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сменить пароль" }));
  await waitFor(() => expect(api.changeUserPassword).toHaveBeenCalledWith(
    "test-token", "employee-1", "Secure-New-Password-2026!",
  ));
});

it("preserves an unsaved password and invitation while navigating", async () => {
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  const password = document.querySelector<HTMLInputElement>('[data-account-section="password"] input[type="password"]')!;
  fireEvent.change(password, { target: { value: "My-draft-password-2026!" } });
  fireEvent.click(screen.getByRole("button", { name: "Приглашения" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Имя сотрудника" }), { target: { value: "Черновик приглашения" } });
  fireEvent.click(screen.getByRole("button", { name: "Личные данные" }));
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  expect(password).toHaveValue("My-draft-password-2026!");
  fireEvent.click(screen.getByRole("button", { name: "Приглашения" }));
  expect(screen.getByRole("textbox", { name: "Имя сотрудника" })).toHaveValue("Черновик приглашения");
  expect(api.changeOwnPassword).not.toHaveBeenCalled();
  expect(api.createInvitation).not.toHaveBeenCalled();
});

it("keeps administrative forms unavailable to an ordinary employee", () => {
  render(<FluentProvider theme={webLightTheme}><AccountPanel token="test-token"
    user={{ id: "employee-1", username: "employee", name: "Сотрудник", initials: "С", role: "employee", color: "#0091a8" }}
    onClose={vi.fn()} onLogout={vi.fn()} /></FluentProvider>);
  expect(screen.queryByRole("button", { name: "Приглашения" })).not.toBeInTheDocument();
  expect(document.querySelector('[data-account-section="managed-password"]')).toBeNull();
  expect(document.querySelector('[data-account-section="recovery"]')).toBeNull();
});

it("opens a focused standalone invitation without unrelated settings", async () => {
  render(<FluentProvider theme={webLightTheme}><AccountPanel token="test-token" initialSection="invite"
    user={{ id: "admin-1", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "#0091a8" }}
    onClose={vi.fn()} onLogout={vi.fn()} /></FluentProvider>);
  expect(screen.getByRole("dialog", { name: "Приглашение сотрудника" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { name: "Пригласить сотрудника" })).toHaveLength(1);
  expect(document.querySelector(".account-invite-only")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Имя сотрудника" })).toHaveFocus());
});

it("requires confirmation to revoke a session and retains it on failure", async () => {
  api.loadSessions.mockResolvedValue([{ id: "other-session", deviceLabel: "Другой браузер", lastSeenAt: "2026-10-04T01:00:00Z", current: false }]);
  api.revokeSession.mockRejectedValueOnce(new Error("Не удалось завершить сеанс"));
  const onLogout = vi.fn();
  renderPanel(onLogout);
  fireEvent.click(screen.getByRole("button", { name: "Устройства" }));
  fireEvent.click(await screen.findByRole("button", { name: "Завершить" }));
  expect(api.revokeSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Завершить сеанс" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Не удалось завершить сеанс"));
  expect(screen.getByText("Другой браузер", { exact: true })).toBeInTheDocument();
  expect(onLogout).not.toHaveBeenCalled();
  api.revokeSession.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Завершить сеанс" }));
  await waitFor(() => expect(screen.queryByText("Другой браузер", { exact: true })).not.toBeInTheDocument());
  expect(onLogout).not.toHaveBeenCalled();
});

it("does not show a failed security request as disabled protection and allows retry", async () => {
  api.getTotpStatus.mockRejectedValueOnce(new Error("Защита временно недоступна"));
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Защита временно недоступна"));
  expect(screen.getByRole("button", { name: "Настроить TOTP" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Настроить TOTP" })).toBeEnabled());
});

it("keeps a TOTP setup across navigation and confirms only a complete code", async () => {
  api.setupTotp.mockResolvedValue({ secret: "QA-SECRET-ONLY", otpauthUrl: "otpauth://qa" });
  api.confirmTotp.mockResolvedValue(undefined);
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Настроить TOTP" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Настроить TOTP" }));
  await screen.findByText("QA-SECRET-ONLY");
  fireEvent.change(screen.getByRole("textbox", { name: "Код подтверждения" }), { target: { value: "123abc" } });
  expect(screen.getByRole("button", { name: "Подтвердить" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Личные данные" }));
  fireEvent.click(screen.getByRole("button", { name: "Защита и пароль" }));
  expect(screen.getByRole("textbox", { name: "Код подтверждения" })).toHaveValue("123");
  fireEvent.change(screen.getByRole("textbox", { name: "Код подтверждения" }), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
  await waitFor(() => expect(api.confirmTotp).toHaveBeenCalledWith("test-token", "123456"));
  await waitFor(() => expect(screen.queryByText("QA-SECRET-ONLY")).not.toBeInTheDocument());
});

it("submits an invitation explicitly and keeps the entered fields on refusal", async () => {
  api.createInvitation.mockRejectedValue(new Error("Логин уже занят"));
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Приглашения" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Имя сотрудника" }), { target: { value: "Новый сотрудник" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Логин" }), { target: { value: "new-user" } });
  fireEvent.click(screen.getByRole("button", { name: "Создать приглашение" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Логин уже занят"));
  expect(api.createInvitation).toHaveBeenCalledWith("test-token", { fullName: "Новый сотрудник", username: "new-user", role: "employee", positionId: undefined });
  expect(screen.getByRole("textbox", { name: "Логин" })).toHaveValue("new-user");
  expect(screen.getByRole("button", { name: "Создать приглашение" })).toBeEnabled();
});

it("retains explicit recovery and second-factor reset options", async () => {
  api.createPasswordReset.mockResolvedValue({ username: "employee", resetToken: "QA-RESET-ONLY" });
  renderPanel();
  fireEvent.click(screen.getByRole("button", { name: "Восстановление доступа" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Логин сотрудника" }), { target: { value: "employee" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Также сбросить двухфакторную защиту" }));
  fireEvent.click(screen.getByRole("button", { name: "Создать код сброса" }));
  await waitFor(() => expect(api.createPasswordReset).toHaveBeenCalledWith("test-token", "employee", true));
  expect(await screen.findByText("QA-RESET-ONLY")).toBeInTheDocument();
});

it("does not sign out of the current session until confirmed and successfully revoked", async () => {
  api.loadSessions.mockResolvedValue([{ id: "current-session", deviceLabel: "Текущий браузер", lastSeenAt: "2026-10-04T01:00:00Z", current: true }]);
  api.revokeSession.mockResolvedValue(undefined);
  const onLogout = vi.fn();
  renderPanel(onLogout);
  fireEvent.click(screen.getByRole("button", { name: "Устройства" }));
  fireEvent.click(await screen.findByRole("button", { name: "Выйти" }));
  expect(onLogout).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(api.revokeSession).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
  fireEvent.click(screen.getByRole("button", { name: "Завершить сеанс" }));
  await waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
  expect(api.revokeSession).toHaveBeenCalledWith("test-token", "current-session");
});
