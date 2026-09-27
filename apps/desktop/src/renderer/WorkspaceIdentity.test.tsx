import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceTheme } from "./workspace-theme";
import { ConnectionIndicator, WorkspaceIdentity } from "./WorkspaceIdentity";
import releaseNotes from "../../release-notes.json";

const person = {
  id: "person-1",
  username: "malika",
  name: "Малика Нурова",
  initials: "МН",
  color: "#d9bd72",
  role: "employee" as const,
  jobTitle: "Руководитель проекта",
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("WorkspaceIdentity", () => {
  it("opens profile, settings and logout actions from one avatar menu", () => {
    const onProfile = vi.fn();
    const onSettings = vi.fn();
    const onLogout = vi.fn();
    render(
      <FluentProvider theme={workspaceTheme}>
        <WorkspaceIdentity person={person} token="token" onProfile={onProfile} onSupport={vi.fn()} supportMode="support" onSettings={onSettings} onLogout={onLogout} />
      </FluentProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Открыть меню профиля: Малика Нурова" }));
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

  it("opens versioned release history from the connection popover", () => {
    render(<FluentProvider theme={workspaceTheme}><ConnectionIndicator detail="Сервер подключён" error={false} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Подключение: Сервер подключён" }));
    fireEvent.click(screen.getByRole("button", { name: "Ранние обновления" }));
    expect(screen.getByRole("dialog", { name: "Ранние обновления" })).toBeInTheDocument();
    const versionPicker = screen.getByRole("combobox", { name: "Версия обновления" });
    expect(versionPicker).toHaveValue(releaseNotes.version);
    fireEvent.click(versionPicker);
    expect(screen.getAllByRole("option").slice(0, 4).map((option) => option.textContent)).toEqual([
      "Версия 1.0.18",
      "Версия 1.0.17",
      "Версия 1.0.16",
      "Версия 1.0.15",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "Версия 1.0.0" }));
    expect(versionPicker).toHaveValue("1.0.0");
    expect(screen.getByRole("dialog", { name: "Ранние обновления" })).toHaveTextContent("Обновление 1.0.0");
  });
});
