import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "@yuksalish/contracts";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { ForwardedMessage } from "./ForwardedMessage";

const message: ChatMessage = { id: "copy", chatId: "team", authorId: "sender", own: false,
  body: "Подтверждаем встречу", time: "14:09", forwarded: {
    kind: "message", authorId: "original-author", authorName: "Автор сообщения", available: true,
  } };
afterEach(cleanup);
it("opens the original author's profile, including from the keyboard", () => {
  const openProfile = vi.fn();
  render(<EmployeeProfileProvider onOpenProfile={openProfile}><ForwardedMessage message={message} /></EmployeeProfileProvider>);
  expect(screen.getByRole("region", { name: "Пересланное сообщение" })).toHaveTextContent(message.body);
  const author = screen.getByRole("button", { name: "Открыть профиль: Автор сообщения" });
  fireEvent.click(author);
  fireEvent.keyDown(author, { key: "Enter" });
  expect(openProfile).toHaveBeenNthCalledWith(1, "original-author");
  expect(openProfile).toHaveBeenNthCalledWith(2, "original-author");
});
it("does not infer forwarding from ordinary text", () => {
  const { container } = render(<ForwardedMessage message={{ ...message, forwarded: null, body: "Переслано от Автор сообщения:\nПодтверждаем встречу" }} />);
  expect(container).toBeEmptyDOMElement();
});
it("opens the actual announcement separately from the author", () => {
  const openPost = vi.fn(), openProfile = vi.fn();
  render(<EmployeeProfileProvider onOpenProfile={openProfile}><ForwardedMessage message={{ ...message, forwarded: {
    ...message.forwarded!, kind: "feed", postId: "real-post", title: "Новости команды",
  } }} onOpenPost={openPost} /></EmployeeProfileProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Новости команды/ }));
  expect(openPost).toHaveBeenCalledWith("real-post");
  expect(openProfile).not.toHaveBeenCalled();
});
it("renders an unavailable original without an actionable link or excerpt", () => {
  const openPost = vi.fn();
  render(<ForwardedMessage message={{ ...message, forwarded: {
    kind: "feed", authorId: null, authorName: "Объявление недоступно", available: false, postId: "deleted",
  } }} onOpenPost={openPost} />);
  const card = screen.getByRole("button", { name: /Оригинал недоступен/ });
  expect(card).toBeDisabled();
  expect(screen.queryByText(message.body)).not.toBeInTheDocument();
  fireEvent.click(card);
  expect(openPost).not.toHaveBeenCalled();
});
