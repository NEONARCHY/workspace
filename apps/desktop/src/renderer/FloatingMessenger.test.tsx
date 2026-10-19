import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { FloatingMessenger } from "./FloatingMessenger";
import type { MessengerViewProps } from "./MessengerView";
import { initialChats } from "./test-fixtures/demo-data";

vi.mock("./MessengerView", () => ({
  MessengerView: (props: MessengerViewProps) => {
    const [draft, setDraft] = useState("");
    return <div data-testid="shared-messenger" data-visible={String(props.visible)} data-compact={String(props.compact)}>
      <input aria-label="Test draft" value={draft} onChange={event => setDraft(event.target.value)} />
      <button onClick={() => props.onActiveChatChange?.("finance")}>Choose finance</button>
    </div>;
  },
}));
const messenger: MessengerViewProps = {
  currentUserId: "qa", currentUserRole: "employee", chats: initialChats, messages: [], tasks: [],
  people: [], attachments: [], token: "",
  chatActions: { create: vi.fn(), update: vi.fn(), add: vi.fn(), setMember: vi.fn(), remove: vi.fn(), transfer: vi.fn(), delete: vi.fn() },
  onSendMessage: vi.fn(), onSendVoiceMessage: vi.fn(), onReactMessage: vi.fn(), onPinMessage: vi.fn(),
  onEditMessage: vi.fn(), onDeleteMessage: vi.fn(), onCreateTaskFromMessage: vi.fn(),
  onDownloadAttachment: vi.fn(), onLoadAttachment: vi.fn(), onMarkRead: vi.fn(),
};
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const view = (fullPage = false, onOpenFullPage = vi.fn()) => <FluentProvider theme={webLightTheme}>
  <FloatingMessenger messenger={messenger} fullPage={fullPage} pageSlot={fullPage ? document.body : null} onOpenFullPage={onOpenFullPage} />
</FluentProvider>;
it("opens a modeless panel, retains its draft on minimize and expands without another messenger", () => {
  const expand = vi.fn();
  const rendered = render(view(false, expand));
  const launcher = screen.getByRole("button", { name: "Открыть мини-мессенджер" });
  expect(launcher).toHaveAttribute("data-unread", "true");
  expect(screen.queryByTestId("shared-messenger")).not.toBeInTheDocument();
  fireEvent.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Мини-мессенджер" });
  expect(dialog).toHaveAttribute("aria-modal", "false");
  fireEvent.change(screen.getByLabelText("Test draft"), { target: { value: "Не потерять" } });
  fireEvent.click(screen.getByText("Choose finance"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Свернуть мини-мессенджер" }));
  expect(screen.queryByRole("dialog", { name: "Мини-мессенджер" })).not.toBeInTheDocument();
  fireEvent.click(launcher);
  expect(screen.getByLabelText("Test draft")).toHaveValue("Не потерять");
  fireEvent.click(screen.getByRole("button", { name: "Открыть полный мессенджер" }));
  expect(expand).toHaveBeenCalledWith("finance");
  rendered.rerender(view(true, expand));
  expect(screen.getAllByTestId("shared-messenger")).toHaveLength(1);
  expect(screen.getByLabelText("Test draft")).toHaveValue("Не потерять");
  expect(screen.getByTestId("shared-messenger")).toHaveAttribute("data-compact", "false");
});
it("supports keyboard repositioning, reset and Escape without changing unread messages", () => {
  render(view());
  const launcher = screen.getByRole("button", { name: "Открыть мини-мессенджер" });
  const before = launcher.style.transform;
  fireEvent.keyDown(launcher, { key: "ArrowLeft", altKey: true });
  expect(launcher.style.transform).not.toBe(before);
  expect(JSON.parse(localStorage.getItem("ws:mini-messenger-position:qa")!)).toMatchObject({ y: 1 });
  fireEvent.keyDown(launcher, { key: "Home", altKey: true });
  expect(launcher.style.transform).toBe(before);
  fireEvent.click(launcher);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Мини-мессенджер" }), { key: "Escape" });
  expect(launcher).toHaveAttribute("aria-expanded", "false");
});
it("does not hide an active voice draft and yields to real modal dialogs", async () => {
  render(view());
  const launcher = screen.getByRole("button", { name: "Открыть мини-мессенджер" });
  fireEvent.click(launcher);
  const shared = screen.getByTestId("shared-messenger");
  shared.classList.add("has-voice-draft");
  fireEvent.click(screen.getByRole("button", { name: "Свернуть мини-мессенджер" }));
  expect(screen.getByRole("dialog", { name: "Мини-мессенджер" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("отправьте или отмените голосовое");
  const modal = document.createElement("section"); modal.setAttribute("role", "dialog"); document.body.append(modal);
  await waitFor(() => expect(launcher).toBeDisabled());
  modal.remove();
  await waitFor(() => expect(launcher).not.toBeDisabled());
  shared.classList.remove("has-voice-draft");
  fireEvent.click(screen.getByRole("button", { name: "Свернуть мини-мессенджер" }));
  expect(launcher).toHaveAttribute("aria-expanded", "false");
});
