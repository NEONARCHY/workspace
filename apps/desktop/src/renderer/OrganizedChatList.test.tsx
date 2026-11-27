import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { ChatSummary } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizedChatList } from "./OrganizedChatList";
import { defaultPersonalPreferences } from "./personal-organization";
import { initialChats, initialMessages, people } from "./test-fixtures/demo-data";

const chats = (kind: "group" | "task" | "project" | "project_hub" | "trip", count = 47): ChatSummary[] => Array.from({ length: count }, (_, i) => ({
  ...initialChats[0]!, id: `${kind}-${i}`, title: `Переписка ${kind} ${String(i).padStart(3, "0")}`, unread: 1,
  kind: kind === "task" ? "task" : "group", contextType: kind === "group" ? undefined : kind,
}));
const list = (items: readonly ChatSummary[], extra: Partial<Parameters<typeof OrganizedChatList>[0]> = {}) => <FluentProvider theme={webLightTheme}>
  <OrganizedChatList chats={items} messages={[]} preferences={defaultPersonalPreferences} onSelect={vi.fn()} {...extra} />
</FluentProvider>;
const rows = () => document.querySelectorAll(".chat-list > [data-chat-id], .chat-list > [data-person-id]");
const load = () => fireEvent.click(screen.getByRole("button", { name: "Показать ещё 15" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["group", "task", "project", "project_hub", "trip", "archive"] as const)("limits %s rows to batches of 15 and reaches the last chat", kind => {
  const items = chats(kind === "archive" ? "group" : kind), onSelect = vi.fn();
  render(list(items, { onSelect, ...(kind === "archive" ? { preferences: { ...defaultPersonalPreferences, archivedChatIds: items.map(chat => chat.id) } } : {}) }));
  if (kind === "task") fireEvent.click(screen.getByRole("button", { name: "Чаты задач" }));
  if (kind === "archive") fireEvent.click(screen.getByRole("button", { name: /^Архив/ }));
  if (["project", "project_hub", "trip"].includes(kind)) {
    fireEvent.click(screen.getByRole("button", { name: /^Ещё/ }));
    fireEvent.transitionEnd(document.querySelector(".chat-bucket-slider")!, { propertyName: "transform" });
    fireEvent.click(screen.getByRole("menuitem", { name: kind === "trip" ? /Чаты поездок/ : /Чаты проектов/ }));
  }
  expect(rows()).toHaveLength(15);
  expect(screen.getByText("Показано 15 из 47")).toBeInTheDocument();
  load(); expect(rows()).toHaveLength(30);
  expect(document.activeElement?.closest("[data-chat-id]")).toHaveAttribute("data-chat-id", items[15]!.id);
  load(); expect(rows()).toHaveLength(45);
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 2" }));
  expect(rows()).toHaveLength(47);
  fireEvent.click(within(screen.getByRole("list")).getByRole("button", { name: new RegExp(items[46]!.title) }));
  expect(onSelect).toHaveBeenCalledWith(items[46]!.id);
});

it("loads one batch per intersection, keeps it on refresh and disconnects on exit", () => {
  const observers: { callback: (entries: { isIntersecting: boolean }[]) => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn(); disconnect = vi.fn();
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { observers.push({ callback, disconnect: this.disconnect }); }
  });
  const items = chats("group"), view = render(list(items));
  expect(rows()).toHaveLength(15);
  act(() => {
    observers[0]!.callback([{ isIntersecting: false }]);
    observers[0]!.callback([{ isIntersecting: true }]);
    observers[0]!.callback([{ isIntersecting: true }]);
  });
  expect(rows()).toHaveLength(30);
  expect(observers[0]!.disconnect).toHaveBeenCalled();
  view.rerender(list([...items])); expect(rows()).toHaveLength(30);
  const last = observers.at(-1)!;
  view.unmount(); expect(last.disconnect).toHaveBeenCalled();
  act(() => last.callback([{ isIntersecting: true }])); expect(rows()).toHaveLength(0);
  render(list(items)); expect(rows()).toHaveLength(15);
});

it("searches beyond the mounted batch and resets the count and scroll on search and folder changes", () => {
  const items = [...chats("group"), ...chats("task")];
  render(list(items, { messages: [{ ...initialMessages[0]!, chatId: "group-46", body: "Искомый результат", deletedAt: undefined }] }));
  const input = screen.getByRole("textbox", { name: "Поиск чатов и сообщений" });
  load(); expect(rows()).toHaveLength(30);
  const rail = screen.getByRole("list"); rail.scrollTop = 800;
  fireEvent.change(input, { target: { value: "Искомый результат" } });
  expect(rows()).toHaveLength(1); expect(rows()[0]).toHaveAttribute("data-chat-id", "group-46");
  expect(rail.scrollTop).toBe(0);
  fireEvent.change(input, { target: { value: "" } }); expect(rows()).toHaveLength(15);
  load(); expect(rows()).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Чаты задач" })); expect(rows()).toHaveLength(15);
  load(); expect(rows()).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: /^Чаты\s+\d/ })); expect(rows()).toHaveLength(15);
  load(); expect(rows()).toHaveLength(30);
});

it("batches contacts with chats and keeps every pinned identity in reorder requests", async () => {
  const items = chats("group", 20), reorder = vi.fn().mockResolvedValue(undefined);
  const contacts = Array.from({ length: 20 }, (_, i) => ({ ...people[0]!, id: `contact-${i}`, name: `Контакт ${i}` }));
  render(list(items, { people: contacts, preferences: { ...defaultPersonalPreferences, pinnedChatIds: items.map(chat => chat.id) }, onReorder: reorder }));
  expect(rows()).toHaveLength(15); expect(document.querySelectorAll("[data-person-id]")).toHaveLength(0);
  fireEvent.contextMenu(document.querySelector(`[data-chat-id="${items[0]!.id}"] .chat-row`)!);
  fireEvent.click(screen.getByText("Переместить ниже"));
  expect(reorder).toHaveBeenCalledWith([items[1]!.id, items[0]!.id, ...items.slice(2).map(chat => chat.id)]);
  await waitFor(() => expect(document.querySelector(".organization-live")).toHaveTextContent("Порядок закреплённых чатов сохранён"));
  load(); expect(rows()).toHaveLength(30); expect(document.querySelectorAll("[data-person-id]")).toHaveLength(10);
});

it("keeps the moved pin reachable when a keyboard action crosses the loaded edge", async () => {
  const items = chats("group", 20), reorder = vi.fn().mockResolvedValue(undefined);
  render(list(items, { preferences: { ...defaultPersonalPreferences, pinnedChatIds: items.map(chat => chat.id) }, onReorder: reorder }));
  fireEvent.contextMenu(document.querySelector('[data-chat-id="group-14"] .chat-row')!);
  fireEvent.click(screen.getByText("Переместить ниже"));
  expect(rows()).toHaveLength(20);
  await waitFor(() => expect(document.activeElement?.closest("[data-chat-id]")).toHaveAttribute("data-chat-id", "group-14"));
  expect(reorder.mock.calls[0]![0]).toHaveLength(20);
});
