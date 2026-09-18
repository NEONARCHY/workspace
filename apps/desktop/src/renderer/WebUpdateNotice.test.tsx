import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkWebVersion } = vi.hoisted(() => ({ checkWebVersion: vi.fn() }));

vi.mock("./platform-adapter", () => ({
  requestWebReload: vi.fn(),
  workspacePlatform: {
    kind: "web",
    version: "0.30.3",
    buildId: "old-build",
    checkWebVersion,
  },
}));
vi.mock("./workspace-api", () => ({ hasPendingMutation: () => false }));

import { WebUpdateNotice } from "./WebUpdateNotice";

describe("WebUpdateNotice", () => {
  beforeEach(() => {
    checkWebVersion.mockResolvedValue({
      buildId: "new-build",
      version: "1.0.0",
      builtAt: "2026-09-19T00:00:00Z",
      title: "Workspace стал удобнее",
      notes: ["Обновили рабочие экраны.", "Улучшили сообщения и медиафайлы."],
    });
  });

  it("shows the new version and understandable release notes in a dialog", async () => {
    render(<WebUpdateNotice />);
    expect(await screen.findByRole("dialog", { name: "Workspace стал удобнее" })).toBeInTheDocument();
    expect(screen.getByText("1.0.0")).toBeInTheDocument();
    expect(screen.getByText("Обновили рабочие экраны.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить до 1.0.0" })).toBeEnabled();
    await waitFor(() => expect(checkWebVersion).toHaveBeenCalledTimes(1));
  });
});
