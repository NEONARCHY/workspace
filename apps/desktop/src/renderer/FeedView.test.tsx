import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeedPost } from "@yuksalish/contracts";
import { FeedView } from "./FeedView";
import { people } from "./test-fixtures/demo-data";

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
});

describe("feed reply threads", () => {
  afterEach(cleanup);

  it("collapses replies per root and preserves nested reply actions", async () => {
    const post: FeedPost = {
      ...birthday, id: "discussion", authorUserId: "aziza", systemKind: null,
      title: "Обновление проекта", body: "Обсудим здесь детали.",
      comments: [
        { id: "root", authorUserId: "baxtiyor", body: "План посмотрел.", createdAt: "2026-10-03T08:00:00Z" },
        { id: "reply", authorUserId: "aziza", parentCommentId: "root", body: "Спасибо за проверку.", createdAt: "2026-10-03T08:05:00Z" },
        { id: "nested", authorUserId: "dilshod", parentCommentId: "reply", body: "И я согласен.", createdAt: "2026-10-03T08:06:00Z" },
        { id: "another-root", authorUserId: "dilshod", body: "Отдельный вопрос по сроку.", createdAt: "2026-10-03T08:10:00Z" },
      ],
    };
    const onComment = vi.fn().mockResolvedValue(post);
    render(<FluentProvider theme={webLightTheme}><FeedView
      posts={[post]} people={people} token="token" currentUserId="aziza"
      onCreate={vi.fn()} onComment={onComment} onReact={vi.fn()}
      onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
    /></FluentProvider>);

    const toggle = screen.getByRole("button", { name: "Показать ответы · 2" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Отдельный вопрос по сроку.")).toBeVisible();
    expect(screen.getByText("Спасибо за проверку.")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Скрыть ответы" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Спасибо за проверку.")).toBeVisible();
    expect(screen.getByText("И я согласен.")).toBeVisible();

    const reply = screen.getByText("И я согласен.").closest(".feed-comment")!;
    fireEvent.click(within(reply as HTMLElement).getByRole("button", { name: "Ответить" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Комментарий к публикации Обновление проекта" }), { target: { value: "Учёл, спасибо." } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить комментарий" }));
    await waitFor(() => expect(onComment).toHaveBeenCalledWith(post, "Учёл, спасибо.", "nested"));
    expect(screen.getByRole("button", { name: "Скрыть ответы" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Скрыть ответы" }));
    expect(screen.getByText("И я согласен.")).not.toBeVisible();
  });
});
