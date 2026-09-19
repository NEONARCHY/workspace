import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { AccountPanel } from "./AccountPanel";

const api = vi.hoisted(() => ({
  changeOwnPassword: vi.fn(),
  changeUserPassword: vi.fn(),
  getTotpStatus: vi.fn().mockResolvedValue({ enabled: false }),
  loadSessions: vi.fn().mockResolvedValue([]),
  loadDirectory: vi.fn().mockResolvedValue({
    positions: [],
    employees: [
      { id: "employee-1", username: "employee", name: "Сотрудник", role: "employee", status: "active" },
      { id: "admin-2", username: "otheradmin", name: "Другой администратор", role: "admin", status: "active" },
    ],
  }),
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
});

it("opens settings at the top-right anchor and closes without a transition", () => {
  const onClose = vi.fn();
  render(
    <FluentProvider theme={webLightTheme}>
      <AccountPanel token="test-token"
        anchor={{ top: 64, offsetRight: 22, originRight: 48 }}
        user={{ id: "admin-1", username: "admin", name: "Администратор", initials: "А", role: "admin", color: "#0091a8" }}
        onClose={onClose} onLogout={vi.fn()} />
    </FluentProvider>,
  );

  const scrim = document.querySelector(".account-profile-anchor");
  expect(scrim).not.toHaveClass("is-opening");
  expect(scrim).not.toHaveClass("is-closing");
  expect(scrim).toHaveStyle({ "--account-anchor-top": "64px", "--account-anchor-right": "22px", "--account-origin-right": "48px" });
  expect(screen.getByRole("dialog", { name: "Настройки профиля" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(onClose).toHaveBeenCalledOnce();
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
  const input = document.querySelector<HTMLInputElement>('.account-avatar-action input[type="file"]');
  if (!input) throw new Error("Avatar input was not rendered");
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "avatar.jpg", { type: "image/jpeg" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(api.uploadProfileAvatar).toHaveBeenCalledWith("test-token", file));
  expect(onAvatarChanged).toHaveBeenCalledWith("2026-09-19T12:00:00Z");
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
