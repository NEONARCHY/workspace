import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyProfileAvatarChanged, ProfileAvatar } from "./ProfileAvatar";
import * as api from "./workspace-api";

const photo = new Blob(["test photo"], { type: "image/png" });
const wrap = (node: React.ReactNode) => <FluentProvider theme={webLightTheme}>{node}</FluentProvider>;
beforeEach(() => {
  vi.spyOn(api, "loadProfileAvatar").mockResolvedValue(photo);
  let index = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:profile-test-${++index}`);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("shared profile avatars", () => {
  it("does not request a photo without its version or authentication", () => {
    const person = { id: "avatar-no-photo", name: "Азиза Каримова" };
    const view = render(wrap(<ProfileAvatar person={person} token="test-token" size={36} />));
    expect(screen.getByRole("img", { name: person.name })).toHaveTextContent("АК");
    view.rerender(wrap(<ProfileAvatar person={{ ...person, avatarVersion: "v1" }} size={36} />));
    expect(api.loadProfileAvatar).not.toHaveBeenCalled();
  });

  it("uses the authenticated versioned photo and reuses it at another size", async () => {
    const person = { id: "avatar-cache", name: "Азиза Каримова", avatarVersion: "v1" };
    const view = render(wrap(<ProfileAvatar person={person} token="test-token" size={36} aria-hidden />));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-1"));
    expect(api.loadProfileAvatar).toHaveBeenCalledWith("test-token", person.id, "v1");
    expect(view.container.querySelector(".fui-Avatar")).toHaveAttribute("aria-hidden", "true");
    view.rerender(wrap(<ProfileAvatar person={person} token="test-token" size={40} />));
    expect(api.loadProfileAvatar).toHaveBeenCalledTimes(1);
    view.rerender(wrap(<ProfileAvatar person={{ ...person, avatarVersion: "v2" }} token="test-token" size={40} />));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-2"));
    expect(api.loadProfileAvatar).toHaveBeenLastCalledWith("test-token", person.id, "v2");
  });

  it("keeps initials when the protected photo request fails", async () => {
    vi.mocked(api.loadProfileAvatar).mockRejectedValue(new Error("unavailable"));
    const person = { id: "avatar-failure", name: "Азиза Каримова", avatarVersion: "v1" };
    render(wrap(<ProfileAvatar person={person} token="test-token" size={32} />));
    await waitFor(() => expect(api.loadProfileAvatar).toHaveBeenCalled());
    expect(screen.getByRole("img", { name: person.name })).toHaveTextContent("АК");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("does not let an older pending photo replace a newer version", async () => {
    let finishOld!: (blob: Blob) => void;
    vi.mocked(api.loadProfileAvatar).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; })).mockResolvedValue(photo);
    const person = { id: "avatar-race", name: "Азиза Каримова", avatarVersion: "old" };
    const view = render(wrap(<ProfileAvatar person={person} token="test-token" size={36} />));
    view.rerender(wrap(<ProfileAvatar person={{ ...person, avatarVersion: "new" }} token="test-token" size={36} />));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-1"));
    await act(async () => { finishOld(photo); });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-1");
  });

  it("refreshes mounted copies after upload without overwriting newer server data", async () => {
    const person = { id: "avatar-upload", name: "Азиза Каримова" };
    const view = render(wrap(<ProfileAvatar person={person} token="test-token" size={36} />));
    act(() => notifyProfileAvatarChanged("another-person", "v1"));
    expect(api.loadProfileAvatar).not.toHaveBeenCalled();
    act(() => notifyProfileAvatarChanged(person.id, "v1"));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-1"));
    view.rerender(wrap(<ProfileAvatar person={{ ...person, avatarVersion: "v2" }} token="test-token" size={36} />));
    await waitFor(() => expect(api.loadProfileAvatar).toHaveBeenLastCalledWith("test-token", person.id, "v2"));
    await waitFor(() => expect(view.container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:profile-test-2"));
  });
});
