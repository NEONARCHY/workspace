import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskPersonAvatar } from "./TaskPersonAvatar";
import * as api from "./workspace-api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("task person avatars", () => {
  it("loads a saved employee photo when the task has an authenticated person", async () => {
    vi.spyOn(api, "loadProfileAvatar").mockResolvedValue(new Blob(["photo"], { type: "image/png" }));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:task-person-photo");
    const person = { id: "task-photo-employee", name: "Азиза Каримова", initials: "АК", role: "employee", color: "blue", avatarVersion: "v1" };
    const view = render(<FluentProvider theme={webLightTheme}><TaskPersonAvatar person={person} token="test-token" size={48} /></FluentProvider>);
    await waitFor(() => expect(api.loadProfileAvatar).toHaveBeenCalledWith("test-token", person.id, "v1"));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:task-person-photo"));
  });

  it("shows initials when no employee photo is available", () => {
    const load = vi.spyOn(api, "loadProfileAvatar");
    render(<FluentProvider theme={webLightTheme}><TaskPersonAvatar fallbackName="Азиза Каримова" size={32} /></FluentProvider>);
    expect(screen.getByText("АК")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});
