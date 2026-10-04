import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedPost } from "@yuksalish/contracts";
import { FeedView } from "./FeedView";
import { people } from "./test-fixtures/demo-data";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";

const birthday: FeedPost = {
  id: "birthday-1", authorUserId: null, systemKind: "birthday", birthdayUserId: "colleague-1",
  title: "С днём рождения!", body: "Поздравляем коллегу.", isPinned: false,
  likedByCurrentUser: false, likeCount: 0, reactions: [], canEdit: false,
  canPin: false, comments: [], createdAt: "2026-09-29T08:00:00Z", updatedAt: "2026-09-29T08:00:00Z",
};

function view(canUseAssistant: boolean) {
  return render(<FluentProvider theme={webLightTheme}><FeedView
    posts={[birthday]} people={[]} token="token" currentUserId="employee-1"
    canUseAssistant={canUseAssistant} onCreate={vi.fn()} onComment={vi.fn()}
    onReact={vi.fn()} onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
  /></FluentProvider>);
}

describe("birthday greeting access", () => {
  afterEach(cleanup);

  it("hides AI greeting controls when the assistant is disabled", () => {
    view(false);
    expect(screen.getByText("С днём рождения!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сгенерировать поздравление для коллеги" })).not.toBeInTheDocument();
  });

  it("shows AI greeting controls to employees with assistant access", () => {
    view(true);
    expect(screen.getByRole("button", { name: "Сгенерировать поздравление для коллеги" })).toBeInTheDocument();
  });

  it("requires confirmation to delete a comment and keeps it intact on cancellation", () => {
    const post: FeedPost = { ...birthday, systemKind: null, comments: [{ id: "comment-test", authorUserId: "employee-1", body: "Сохранить этот комментарий", canDelete: true, createdAt: birthday.createdAt }] };
    const onDeleteComment = vi.fn();
    render(<FluentProvider theme={webLightTheme}><FeedView posts={[post]} people={[]} token="token" currentUserId="employee-1"
      onCreate={vi.fn()} onComment={vi.fn()} onReact={vi.fn()} onDeleteComment={onDeleteComment} onPin={vi.fn()} onDelete={vi.fn()}
    /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: "Удалить комментарий" });
    expect(trigger).toHaveAttribute("data-tabster");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Удалить комментарий?" });
    expect(onDeleteComment).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(screen.getByText("Сохранить этот комментарий")).toBeInTheDocument();
    expect(onDeleteComment).not.toHaveBeenCalled();
  });

  it("confirms publication deletion once without invoking comment deletion", async () => {
    const post: FeedPost = { ...birthday, systemKind: null, canDelete: true, title: "Новости команды" };
    const onDelete = vi.fn().mockResolvedValue(true), onDeleteComment = vi.fn();
    render(<FluentProvider theme={webLightTheme}><FeedView posts={[post]} people={[]} token="token" currentUserId="employee-1"
      onCreate={vi.fn()} onComment={vi.fn()} onReact={vi.fn()} onDeleteComment={onDeleteComment} onPin={vi.fn()} onDelete={onDelete}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Удалить публикацию" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить публикацию?" });
    expect(dialog).toHaveAccessibleDescription("Публикация «Новости команды» и её обсуждение будут удалены без возможности восстановления.");
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete).toHaveBeenCalledWith(post);
    expect(onDeleteComment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("opens avatar lists for post and comment reactions without changing the reaction", () => {
    const post: FeedPost = { ...birthday, systemKind: null,
      reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: ["aziza"] }],
      comments: [{ id: "reaction-comment", authorUserId: "baxtiyor", body: "Ответ коллеги", canDelete: false, createdAt: birthday.createdAt,
        reactions: [{ emoji: "❤️", count: 1, reactedByCurrentUser: true, reactorUserIds: ["malika"] }] }],
    };
    const onReact = vi.fn();
    render(<FluentProvider theme={webLightTheme}><FeedView posts={[post]} people={people} token="token" currentUserId="employee-1"
      onCreate={vi.fn()} onComment={vi.fn()} onReact={onReact} onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
    /></FluentProvider>);
    const postReaction = screen.getByRole("button", { name: "👍 1" });
    fireEvent.contextMenu(postReaction, { clientX: 900, clientY: 600 });
    let details = screen.getByRole("dialog", { name: "Кто поставил реакцию" });
    expect(details).toHaveTextContent("Азиза Каримова");
    expect(details.querySelector(".fui-Avatar")).not.toBeNull();
    expect(details.parentElement).toHaveClass("fui-FluentProvider");
    expect(onReact).not.toHaveBeenCalled();
    fireEvent.keyDown(details, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(postReaction).toHaveFocus();
    fireEvent.click(postReaction);
    expect(onReact).toHaveBeenCalledWith(post, "👍", true);

    const commentReaction = screen.getByRole("button", { name: "❤️ 1" });
    fireEvent.keyDown(commentReaction, { key: "F10", shiftKey: true });
    details = screen.getByRole("dialog", { name: "Кто поставил реакцию" });
    expect(details).toHaveTextContent("Малика Нурова");
    expect(details.querySelector(".fui-Avatar")).not.toBeNull();
    fireEvent.pointerDown(details);
    fireEvent.keyDown(details, { key: "Tab" });
    expect(details).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(commentReaction);
    expect(onReact).toHaveBeenCalledWith(post, "❤️", false, "reaction-comment");
  });
  it("handles legacy reaction counts without guessing participants", () => {
    const post: FeedPost = { ...birthday, reactions: [{ emoji: "👀", count: 2, reactedByCurrentUser: false }] };
    render(<FluentProvider theme={webLightTheme}><FeedView posts={[post]} people={people} token="token" currentUserId="employee-1"
      onCreate={vi.fn()} onComment={vi.fn()} onReact={vi.fn()} onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
    /></FluentProvider>);
    fireEvent.contextMenu(screen.getByRole("button", { name: "👀 2" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("2 реакций · список сотрудников недоступен");
  });
  it("opens the selected employee profile before removing the feed reaction menu", () => {
    const post: FeedPost = { ...birthday, reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: ["aziza"] }] };
    const openProfile = vi.fn();
    render(<FluentProvider theme={webLightTheme}><EmployeeProfileProvider onOpenProfile={openProfile}><FeedView posts={[post]} people={people} token="token" currentUserId="employee-1"
      onCreate={vi.fn()} onComment={vi.fn()} onReact={vi.fn()} onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
    /></EmployeeProfileProvider></FluentProvider>);
    fireEvent.contextMenu(screen.getByRole("button", { name: "👍 1" }));
    const details = screen.getByRole("dialog", { name: "Кто поставил реакцию" });
    const row = within(details).getByRole("button", { name: /Азиза Каримова/ });
    fireEvent.pointerDown(row);
    fireEvent.click(row);
    expect(openProfile).toHaveBeenCalledWith("aziza");
    expect(screen.queryByRole("dialog", { name: "Кто поставил реакцию" })).not.toBeInTheDocument();
  });
});
