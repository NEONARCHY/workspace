import { act, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceTheme } from "./workspace-theme";
import { WorkspaceIdentity } from "./WorkspaceIdentity";

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
    expect(onSettings).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(180));
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
