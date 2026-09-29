import { cleanup, render, screen } from "@testing-library/react";
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
});
