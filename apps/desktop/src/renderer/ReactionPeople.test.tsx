import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactionPeople, ReactionDetailsMenu } from "./ReactionPeople";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { people } from "./test-fixtures/demo-data";
import * as api from "./workspace-api";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("reaction participant identity", () => {
  it("loads a saved photo through the authenticated avatar component", async () => {
    const person = { ...people[0]!, id: "reaction-photo-test", avatarVersion: "photo-version" };
    const blob = new Blob(["photo"], { type: "image/png" });
    const load = vi.spyOn(api, "loadProfileAvatar").mockResolvedValue(blob);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reaction-avatar-test");
    render(<FluentProvider theme={webLightTheme}><ReactionPeople reactions={[{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: [person.id] }]} people={[person]} token="test-photo-token" /></FluentProvider>);
    await waitFor(() => expect(document.querySelector(".message-reaction-people .fui-Avatar__image")).toHaveAttribute("src", "blob:reaction-avatar-test"));
    expect(load).toHaveBeenCalledWith("test-photo-token", person.id, "photo-version");
  });

  it("keeps a circular initials avatar when the photo cannot be loaded", async () => {
    const person = { ...people[0]!, id: "reaction-photo-error", avatarVersion: "error-version" };
    const load = vi.spyOn(api, "loadProfileAvatar").mockRejectedValue(new Error("unavailable"));
    render(<FluentProvider theme={webLightTheme}><ReactionPeople reactions={[{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: [person.id] }]} people={[person]} token="test-photo-token" /></FluentProvider>);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.getByRole("img", { name: person.name })).toHaveClass("fui-Avatar");
    expect(document.querySelector(".fui-Avatar__initials")).toHaveTextContent("АК");
  });

  it("opens employee profiles and closes the shared reaction menu through the profile provider", () => {
    const open = vi.fn(), close = vi.fn();
    render(<FluentProvider theme={webLightTheme}><EmployeeProfileProvider onOpenProfile={open}><ReactionDetailsMenu
      target={{ emoji: "👍", x: 80, y: 80, anchor: document.createElement("button") }} onClose={close}
      reactions={[{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: ["aziza"] }]} people={people} token="test"
    /></EmployeeProfileProvider></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Азиза Каримова/ }));
    expect(open).toHaveBeenCalledWith("aziza");
    expect(close).toHaveBeenCalledOnce();
  });
});
