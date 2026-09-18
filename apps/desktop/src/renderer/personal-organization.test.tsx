import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { navigationKeys, type NavigationKey, type PersonalPreferences } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavigationEditor } from "./NavigationEditor";
import { OrganizedChatList } from "./OrganizedChatList";
import { defaultPersonalPreferences, latestPreferences, moveBefore, normalizeNavigation } from "./personal-organization";
import { initialChats, initialMessages } from "./test-fixtures/demo-data";

afterEach(cleanup);
const labels = Object.fromEntries(navigationKeys.map((key) => [key, key])) as Record<NavigationKey, string>;

describe("Personal organization", () => {
  it("moves identities in both directions without losing hidden or future sections", () => {
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b"], "foreign", "a")).toEqual(["a", "b"]);
    expect(moveBefore(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(normalizeNavigation(["calendar", "calendar"])).toEqual(["calendar", ...navigationKeys.filter((key) => key !== "calendar")]);
  });
  it("does not let an older bootstrap overwrite a just-saved preference response", () => {
    const current = { ...defaultPersonalPreferences, revision: 3, pinnedChatIds: ["a"] };
    expect(latestPreferences(current, { ...defaultPersonalPreferences, revision: 2 })).toBe(current);
  });
  it("edits navigation only after save, cancels, restores defaults and keeps the opening revision", async () => {
    const save = vi.fn().mockResolvedValue(undefined), close = vi.fn();
    const view = render(<NavigationEditor order={navigationKeys} revision={4} labels={labels} onSave={save} onClose={close} />);
    expect(screen.getByRole("button", { name: "crm: выше" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "tasks: выше" }));
    expect(save).not.toHaveBeenCalled();
    view.rerender(<NavigationEditor order={navigationKeys} revision={8} labels={labels} onSave={save} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(["tasks", "crm", ...navigationKeys.slice(2)], 4));
    await waitFor(() => expect(close).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "По умолчанию" }));
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-navigation-key", "crm");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("retains the navigation draft and shows an error if saving is rejected", async () => {
    const close = vi.fn();
    render(<NavigationEditor order={navigationKeys} revision={0} labels={labels} onSave={vi.fn().mockRejectedValue(new Error("Конфликт версий"))} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "tasks: выше" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Конфликт версий");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-navigation-key", "tasks");
  });
  it("sorts pinned chats, separates the archive, finds messages and restores without repinning", async () => {
    const first = initialChats[0]!, second = initialChats[1]!;
    function Harness() {
      const [preferences, setPreferences] = useState<PersonalPreferences>({ ...defaultPersonalPreferences, pinnedChatIds: [second.id], archivedChatIds: [first.id] });
      return <FluentProvider theme={webLightTheme}><OrganizedChatList chats={initialChats} messages={initialMessages} preferences={preferences} onSelect={vi.fn()}
        onChange={async (id, action) => { if (action === "unarchive") setPreferences({ ...preferences, archivedChatIds: preferences.archivedChatIds.filter((item) => item !== id) }); }} /></FluentProvider>;
    }
    render(<Harness />);
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-chat-id", second.id);
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Архив/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: `Действия чата «${first.title}»` }));
    // jsdom has no popover layout. Real visibility/accessible roles are covered by Edge/Electron.
    fireEvent.click(screen.getByText("Вернуть из архива"));
    await waitFor(() => expect(screen.getByText("Архив пуст")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Чаты(?:\s+\d|$)/ }));
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-chat-id", second.id);
    expect(screen.getByText(first.title)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск чатов и сообщений" }), { target: { value: "does not exist" } });
    expect(screen.getByText("Чаты не найдены")).toBeInTheDocument();
  });
  it("offers accessible pin reordering and keeps the row when archiving fails", async () => {
    const first = initialChats[0]!, second = initialChats[1]!, reorder = vi.fn().mockResolvedValue(undefined);
    render(<FluentProvider theme={webLightTheme}><OrganizedChatList chats={initialChats} messages={[]} onSelect={vi.fn()}
      preferences={{ ...defaultPersonalPreferences, pinnedChatIds: [first.id, second.id] }} onReorder={reorder} onChange={vi.fn().mockRejectedValue(new Error("Сервер недоступен"))} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: `Действия чата «${first.title}»` }));
    expect(screen.getByText("Переместить выше").closest('[role="menuitem"]')).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByText("Переместить ниже"));
    await waitFor(() => expect(reorder).toHaveBeenCalledWith([second.id, first.id]));
    await waitFor(() => expect(screen.getByRole("button", { name: `Действия чата «${first.title}»` })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: `Действия чата «${first.title}»` }));
    fireEvent.click(screen.getByText("В архив"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0]).toHaveAttribute("data-chat-id", first.id);
  });
});
