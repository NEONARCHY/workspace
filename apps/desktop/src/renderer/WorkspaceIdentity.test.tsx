import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("morphs the identity button into the profile and finishes closing before navigation", () => {
    vi.useFakeTimers();
    const onSettings = vi.fn();
    render(
      <FluentProvider theme={workspaceTheme}>
        <WorkspaceIdentity person={person} token="token" onSettings={onSettings} onLogout={vi.fn()} />
      </FluentProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Профиль: Малика Нурова" }));
    expect(document.querySelector(".identity-popover")).toHaveClass("is-opening");
    fireEvent.click(screen.getByRole("button", { name: "Настройки профиля" }));
    expect(document.querySelector(".identity-popover")).toHaveClass("is-closing");
    expect(onSettings).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledWith({ top: 8, offsetRight: window.innerWidth, originRight: 0 });
    act(() => vi.advanceTimersByTime(180));
  });

  it("opens versioned release history from the connection popover", () => {
    render(<FluentProvider theme={workspaceTheme}><ConnectionIndicator detail="Сервер подключён" error={false} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Подключение: Сервер подключён" }));
    fireEvent.click(screen.getByRole("button", { name: "Ранние обновления" }));
    expect(screen.getByRole("dialog", { name: "Ранние обновления" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Версия обновления" })).toHaveValue(releaseNotes.version);
    fireEvent.change(screen.getByRole("combobox", { name: "Версия обновления" }), { target: { value: "1.0.0" } });
    expect(screen.getAllByText("Версия 1.0.0")).toHaveLength(2);
  });
});
