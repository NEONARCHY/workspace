import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedPost } from "@yuksalish/contracts";
import { FeedView } from "./FeedView";

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
});
