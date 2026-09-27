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
    expect(normalizeNavigation(["tasks", "projects", "settings"])).toEqual([
      "tasks", "projects", "project_hub", "project_funding", "settings",
      ...navigationKeys.filter((key) => !["tasks", "projects", "project_hub", "project_funding", "settings"].includes(key)),
    ]);
  });
  it("does not let an older bootstrap overwrite a just-saved preference response", () => {
    const current = { ...defaultPersonalPreferences, revision: 3, pinnedChatIds: ["a"] };
    expect(latestPreferences(current, { ...defaultPersonalPreferences, revision: 2 })).toBe(current);
  });
  it("edits navigation only after save, cancels, restores defaults and keeps the opening revision", async () => {
    const save = vi.fn().mockResolvedValue(undefined), close = vi.fn();
    const view = render(<NavigationEditor order={navigationKeys} revision={4} labels={labels} onSave={save} onClose={close} />);
    expect(screen.getByRole("button", { name: "Переставить: tasks" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /выше|ниже/i })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    view.rerender(<NavigationEditor order={navigationKeys} revision={8} labels={labels} onSave={save} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(navigationKeys, 4));
    await waitFor(() => expect(close).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "По умолчанию" }));
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-navigation-key", "tasks");
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("retains the navigation draft and shows an error if saving is rejected", async () => {
    const close = vi.fn();
    render(<NavigationEditor order={navigationKeys} revision={0} labels={labels} onSave={vi.fn().mockRejectedValue(new Error("Конфликт версий"))} onClose={close} />);
    expect(screen.getByRole("button", { name: "Переставить: tasks" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Конфликт версий");
    expect(close).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-navigation-key", "tasks");
  });
  it("hides legacy project and payment entries without deleting their saved positions", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<NavigationEditor order={navigationKeys} revision={1} labels={labels}
      hiddenKeys={["projects", "payment_requests"]} onSave={save} onClose={vi.fn()} />);
    expect(screen.queryByRole("listitem", { name: /payment_requests/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: /projects/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(navigationKeys, 1));
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
    expect(screen.queryByText("Перетащите для перестановки")).not.toBeInTheDocument();
    expect(screen.queryByText(first.title)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Архив/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.contextMenu(document.querySelector(`[data-chat-id="${first.id}"] .chat-row`)!);
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
    expect(screen.queryByRole("button", { name: `Переставить: ${first.title}` })).not.toBeInTheDocument();
    fireEvent.contextMenu(document.querySelector(`[data-chat-id="${first.id}"] .chat-row`)!);
    expect(screen.getByText("Переместить выше").closest('[role="menuitem"]')).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByText("Переместить ниже"));
    await waitFor(() => expect(reorder).toHaveBeenCalledWith([second.id, first.id]));
    await waitFor(() => expect(document.querySelector(`[data-chat-id="${first.id}"] .chat-row`)).toBeEnabled());
    fireEvent.contextMenu(document.querySelector(`[data-chat-id="${first.id}"] .chat-row`)!);
    fireEvent.click(screen.getByText("В архив"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер недоступен");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")[0]).toHaveAttribute("data-chat-id", second.id);
  });
  it("keeps a dropped pinned chat in place while saving and rolls back on rejection", async () => {
    const first = initialChats[0]!, second = initialChats[1]!;
    let finishSave: ((error?: Error) => void) | undefined;
    const reorder = vi.fn(() => new Promise<void>((resolve, reject) => {
      finishSave = (error) => error ? reject(error) : resolve();
    }));
    const preferences = { ...defaultPersonalPreferences, pinnedChatIds: [first.id, second.id] };
    const view = render(<FluentProvider theme={webLightTheme}><OrganizedChatList chats={initialChats} messages={[]} onSelect={vi.fn()}
      preferences={preferences} onReorder={reorder} /></FluentProvider>);
    const rowIds = () => within(screen.getByRole("list")).getAllByRole("listitem").slice(0, 2).map((row) => row.getAttribute("data-chat-id"));
    fireEvent.contextMenu(document.querySelector(`[data-chat-id="${first.id}"] .chat-row`)!);
    fireEvent.click(screen.getByText("Переместить ниже"));
    expect(rowIds()).toEqual([second.id, first.id]);
    expect(reorder).toHaveBeenCalledWith([second.id, first.id]);
    expect(screen.getAllByText("Закреплённые")).toHaveLength(1);
    finishSave?.();
    await waitFor(() => expect(document.querySelector(".organization-live")).toHaveTextContent("Порядок закреплённых чатов сохранён"));
    expect(rowIds()).toEqual([second.id, first.id]);
    view.rerender(<FluentProvider theme={webLightTheme}><OrganizedChatList chats={initialChats} messages={[]} onSelect={vi.fn()}
      preferences={{ ...preferences, pinnedChatIds: [second.id, first.id], revision: 1 }} onReorder={reorder} /></FluentProvider>);
    expect(rowIds()).toEqual([second.id, first.id]);
    fireEvent.contextMenu(document.querySelector(`[data-chat-id="${second.id}"] .chat-row`)!);
    fireEvent.click(screen.getByText("Переместить ниже"));
    expect(rowIds()).toEqual([first.id, second.id]);
    finishSave?.(new Error("Не удалось сохранить"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось сохранить"));
    expect(rowIds()).toEqual([second.id, first.id]);
  });
  it("keeps pinned order and raises the chat with the newest message above other chats", () => {
    const [first, second] = initialChats;
    const third = { ...first!, id: "third", title: "Самый новый", canDelete: false };
    const datedMessages = [
      { ...initialMessages[0]!, chatId: first!.id, createdAt: "2026-09-24T08:00:00Z" },
      { ...initialMessages[1]!, chatId: second!.id, createdAt: "2026-09-24T10:00:00Z" },
      { ...initialMessages[2]!, chatId: third.id, createdAt: "2026-09-24T12:00:00Z" },
    ];
    render(<FluentProvider theme={webLightTheme}><OrganizedChatList chats={[first!, second!, third]} messages={datedMessages} onSelect={vi.fn()}
      preferences={{ ...defaultPersonalPreferences, pinnedChatIds: [first!.id] }} /></FluentProvider>);
    expect(screen.getAllByRole("listitem").map((item) => item.getAttribute("data-chat-id"))).toEqual([first!.id, third.id, second!.id]);
  });
  it("opens project and trip conversations as regular lists from the More menu", () => {
    const select = vi.fn();
    const contextChats = [
      { ...initialChats[0]!, id: "project-chat", title: "Проект · Офис", contextType: "project" },
      { ...initialChats[1]!, id: "trip-chat", title: "Поездка · Самарканд", contextType: "trip" },
    ];
    render(<FluentProvider theme={webLightTheme}><OrganizedChatList chats={contextChats} messages={[]} onSelect={select}
      preferences={defaultPersonalPreferences} /></FluentProvider>);
    expect(screen.queryByText("Проект · Офис")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    expect(screen.queryByRole("menuitem", { name: /Чаты проектов/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Папки чатов" })).toHaveClass("is-more");
    fireEvent.transitionEnd(document.querySelector(".chat-bucket-slider")!, { propertyName: "transform" });
    fireEvent.click(screen.getByRole("menuitem", { name: /Чаты проектов/ }));
    const projectList = screen.getByRole("list", { name: "Чаты проектов" });
    fireEvent.click(projectList.querySelector("button.chat-row")!);
    expect(select).toHaveBeenCalledWith("project-chat");
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Чаты поездок/ }));
    const tripList = screen.getByRole("list", { name: "Чаты поездок" });
    expect(within(tripList).getByText("Поездка · Самарканд")).toBeInTheDocument();
    expect(tripList.querySelector("button.chat-row")).toBeInTheDocument();
  });
});
