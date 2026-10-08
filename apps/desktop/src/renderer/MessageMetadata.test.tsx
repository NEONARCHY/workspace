import { cleanup, render, screen } from "@testing-library/react";
import type { ChatMessage } from "@yuksalish/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MessageMetadata } from "./MessageMetadata";

afterEach(cleanup);

const message: ChatMessage = { id: "sent", chatId: "direct", authorId: "me", body: "а", time: "15:47" };

describe("Message status", () => {
  it("uses one check for a persisted message and two only after a server read receipt", () => {
    const { rerender } = render(<MessageMetadata message={message} own />);
    const single = screen.getByRole("img", { name: "Сообщение отправлено" });
    expect(single.querySelectorAll("path")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Сообщение прочитано" })).not.toBeInTheDocument();
    rerender(<MessageMetadata message={{ ...message, readByRecipient: true }} own />);
    expect(screen.getByRole("img", { name: "Сообщение прочитано" }).querySelectorAll("path")).toHaveLength(2);
    expect(screen.getByText("15:47").closest("time")).toHaveClass("message-timestamp");
  });

  it("does not attach sent/read checks to incoming or deleted messages", () => {
    const { rerender } = render(<MessageMetadata message={{ ...message, readByRecipient: true }} own={false} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    rerender(<MessageMetadata message={{ ...message, deletedAt: "2026-10-08T10:47:00Z" }} own />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("15:47")).toBeInTheDocument();
  });
});
