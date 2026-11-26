import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceTheme } from "./workspace-theme";
import { ConnectionIndicator, WorkspaceIdentity } from "./WorkspaceIdentity";
import * as profileAvatar from "./ProfileAvatar";
import { bundledReleaseEntries } from "./release-history";
import * as api from "./workspace-api";

const person = {
  id: "person-1",
  username: "malika",
  name: "Малика Нурова",
  initials: "МН",
  color: "#d9bd72",
  role: "employee" as const,
  jobTitle: "Руководитель проекта",
};

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("WorkspaceIdentity", () => {
  it.each([true, false])("keeps the mode action in the avatar menu when enabled is %s", enabled => {
    render(<FluentProvider theme={workspaceTheme}><WorkspaceIdentity person={{ ...person, role: enabled ? "admin" : "employee" }} token="token" adminModeEnabled={enabled}
      onSupport={vi.fn()} supportMode="support" onSettings={vi.fn()} onLogout={vi.fn()} /></FluentProvider>);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Открыть меню профиля/ }));
    expect(screen.getByRole("switch", { name: "Режим администратора" })).toHaveAttribute("aria-checked", String(enabled));
    expect(screen.getByText(enabled ? "Выключить права администратора" : "Вернуть права администратора")).toBeVisible();
  });

  it("does not offer administrator mode without the account capability", () => {
    render(<FluentProvider theme={workspaceTheme}><WorkspaceIdentity person={person} token="token"
      onSupport={vi.fn()} supportMode="support" onSettings={vi.fn()} onLogout={vi.fn()} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Открыть меню профиля/ }));
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("keeps an outstanding mode change locked and shows its error after reopening the menu", async () => {
    let fail!: (error: Error) => void;
    const change = vi.spyOn(api, "setAdministratorMode").mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    render(<FluentProvider theme={workspaceTheme}><WorkspaceIdentity person={person} token="token" adminModeEnabled
      onSupport={vi.fn()} supportMode="support" onSettings={vi.fn()} onLogout={vi.fn()} /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: /Открыть меню профиля/ });
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(trigger); fireEvent.click(trigger);
    expect(screen.getByRole("switch")).toBeDisabled();
    fireEvent.click(screen.getByRole("switch"));
    expect(change).toHaveBeenCalledExactlyOnceWith("token", false);
    await act(async () => fail(new Error("Нет связи")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет связи");
    await waitFor(() => expect(screen.getByRole("switch")).not.toBeDisabled());
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("opens profile, settings and logout actions from one avatar menu", () => {
    const avatar = vi.spyOn(profileAvatar, "ProfileAvatar");
    const onProfile = vi.fn();
    const onSettings = vi.fn();
    const onLogout = vi.fn();
    render(
      <FluentProvider theme={workspaceTheme}>
        <WorkspaceIdentity person={person} token="token" onProfile={onProfile} onSupport={vi.fn()} supportMode="support" onSettings={onSettings} onLogout={onLogout} />
      </FluentProvider>,
    );

    const profileButton = screen.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" });
    expect(avatar).toHaveBeenCalledWith(expect.objectContaining({ size: 40 }), undefined);
    fireEvent.click(profileButton);
    expect(document.querySelector(".identity-popover")).not.toHaveClass("is-opening");
    expect(document.querySelector(".identity-popover")).not.toHaveClass("is-closing");
    expect(screen.getByRole("button", { name: "Профиль сотрудника" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Поддержка" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Настройки" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Выйти" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Профиль сотрудника" }));
    expect(onProfile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" }));
    fireEvent.click(screen.getByRole("button", { name: "Настройки" }));
    expect(onSettings).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" }));
    fireEvent.click(screen.getByRole("button", { name: "Выйти" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("shows the administrator inbox and a persistent response indicator", () => {
    const onSupport = vi.fn();
    render(
      <FluentProvider theme={workspaceTheme}>
        <WorkspaceIdentity
          person={{ ...person, role: "admin" }}
          token="token"
          onSupport={onSupport}
          supportMode="inbox"
          supportIndicator="negative"
          supportUnreadCount={2}
          onSettings={vi.fn()}
          onLogout={vi.fn()}
        />
      </FluentProvider>,
    );
    const trigger = screen.getByRole("button", { name: /Есть 2 отклонённых ответов/ });
    expect(trigger.querySelector(".tone-negative")).toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Обращения" }));
    expect(onSupport).toHaveBeenCalledOnce();
  });

  it("shows every version and change in one scrollable connection history", () => {
    render(<FluentProvider theme={workspaceTheme}><ConnectionIndicator detail="Сервер подключён" error={false} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Подключение: Сервер подключён" }));
    fireEvent.click(screen.getByRole("button", { name: "Ранние обновления" }));
    expect(screen.getByRole("dialog", { name: "Ранние обновления" })).toBeInTheDocument();
    const latestUpdate = __YUKSALISH_UPDATE_ENTRIES__[0]!;
    const history = screen.getByLabelText("Полная история изменений");
    // Resolve each title by text before checking its accessible heading. This
    // avoids computing accessible names for hundreds of unrelated releases.
    for (const name of [`Обновление ${latestUpdate.version}`, "Обновление 1.0.0"]) {
      const heading = within(history).getByText(name, {
        selector: "h1,h2,h3,h4,h5,h6,[role=heading]",
      });
      const container = heading.parentElement;
      if (!container) throw new Error("Release heading must have a container");
      expect(within(container).getByRole("heading", { name })).toBe(heading);
    }
    expect(history).toHaveAttribute("tabindex", "0");
    expect([...history.querySelectorAll(".release-timeline-body li")].map(item => item.textContent)).toEqual(
      bundledReleaseEntries().flatMap(entry => entry.items),
    );
    expect(history.querySelectorAll("time").length).toBeGreaterThan(1);
  });
});
