import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAvatar, ChatIconPicker, defaultChatIcon } from "./ChatAvatar";
import { initialChats, people } from "./test-fixtures/demo-data";

vi.mock("./ProfileAvatar", () => ({ ProfileAvatar: ({ person, size }: { person: { id: string }; size: number }) => <span data-testid="peer-photo" data-user={person.id} data-size={size} /> }));
afterEach(cleanup);

describe("semantic chat avatars", () => {
  it("uses plane, project and team defaults without changing personal photos", () => {
    expect(defaultChatIcon({ kind: "approval", contextType: "trip" })).toBe("plane");
    expect(defaultChatIcon({ kind: "project", contextType: "project_hub" })).toBe("project");
    expect(defaultChatIcon({ kind: "project", contextType: "project" })).toBe("project");
    expect(defaultChatIcon({ kind: "group", contextType: null })).toBe("team");
    render(<ChatAvatar chat={{ ...initialChats[0]!, kind: "direct", members: [
      { ...initialChats[0]!.members[0]!, userId: people[0]!.id },
      { ...initialChats[0]!.members[0]!, userId: people[1]!.id },
    ] }} people={people} token="test" currentUserId={people[0]!.id} size={56} />);
    expect(screen.getByTestId("peer-photo")).toHaveAttribute("data-user", people[1]!.id);
    expect(screen.getByTestId("peer-photo")).toHaveAttribute("data-size", "56");
  });
  it("renders a saved icon at the requested size", () => {
    const view = render(<ChatAvatar chat={{ ...initialChats[0]!, avatarIconKey: "star" }} people={people} token="test" currentUserId={people[0]!.id} size={56} />);
    expect(view.container.querySelector(".is-star")).toHaveStyle({ width: "56px", height: "56px" });
  });
  it("offers exactly twelve accessible choices and prevents interaction while saving", () => {
    const onChange = vi.fn();
    const view = render(<ChatIconPicker value="plane" onChange={onChange} />);
    expect(screen.getAllByRole("button")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Иконка: Самолёт" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Иконка: Проект" }));
    expect(onChange).toHaveBeenCalledWith("project");
    view.rerender(<ChatIconPicker value="project" onChange={onChange} disabled />);
    expect(screen.getAllByRole("button").every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Иконка: Самолёт" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
