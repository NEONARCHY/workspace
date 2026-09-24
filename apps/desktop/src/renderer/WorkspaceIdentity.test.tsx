import { fireEvent, render, screen } from "@testing-library/react";
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

afterEach(() => vi.useRealTimers());

describe("WorkspaceIdentity", () => {
  it("opens the profile without morph animation and switches directly to settings", () => {
    const onProfile = vi.fn();
    const onSettings = vi.fn();
    render(
      <FluentProvider theme={workspaceTheme}>
        <WorkspaceIdentity person={person} token="token" onProfile={onProfile} onSettings={onSettings} onLogout={vi.fn()} />
      </FluentProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль: Малика Нурова" }));
    expect(onProfile).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Меню профиля" }));
    expect(document.querySelector(".identity-popover")).not.toHaveClass("is-opening");
    expect(document.querySelector(".identity-popover")).not.toHaveClass("is-closing");
    fireEvent.click(screen.getByRole("button", { name: "Открыть рабочий профиль" }));
    expect(onProfile).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Меню профиля" }));
    fireEvent.click(screen.getByRole("button", { name: "Настройки профиля" }));
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledWith({ top: 8, offsetRight: window.innerWidth, originRight: 0 });
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
