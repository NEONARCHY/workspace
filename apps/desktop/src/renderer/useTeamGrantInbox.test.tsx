import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GrantSummary } from "@yuksalish/contracts";
import { loadGrants } from "./workspace-api";
import { useTeamGrantInbox } from "./useTeamGrantInbox";

vi.mock("./workspace-api", () => ({ loadGrants: vi.fn() }));
const grant: GrantSummary = {
  id: "grant", title: "Грант", description: "", initiatorUserId: "initiator",
  authorUserId: null, leaderUserId: "deputy", chairUserId: "chair", workflowVersion: 2,
  launchApprovedAt: null, launchApprovedByUserId: null, assigneeId: "executor",
  coAssigneeIds: [], dueAt: "2099-11-01T12:00:00Z", status: "launch_review", revision: 1,
  checklist: [], resultText: "", chatId: "chat", createdAt: "2026-10-21T12:00:00Z",
  updatedAt: "2026-10-21T12:00:00Z", allowedActions: ["approve_launch"],
};
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("does not request grants without module access", () => {
  renderHook(() => useTeamGrantInbox("token", "chair", false));
  expect(loadGrants).not.toHaveBeenCalled();
});

it("separates launch and result decisions using server-authorized actions", async () => {
  vi.mocked(loadGrants).mockResolvedValue([
    grant, { ...grant, id: "result", status: "chair_review", allowedActions: ["approve"] },
    { ...grant, id: "foreign", chairUserId: "other-chair", allowedActions: [] },
    { ...grant, id: "read-only", allowedActions: [] },
  ]);
  const { result } = renderHook(() => useTeamGrantInbox("token", "chair", true));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.launches?.map((item) => item.id)).toEqual(["grant"]);
  expect(result.current.reviews?.map((item) => item.id)).toEqual(["result"]);
});

it("keeps failed counts unknown and retries explicitly", async () => {
  vi.mocked(loadGrants).mockRejectedValueOnce(new Error("Нет связи")).mockResolvedValue([]);
  const { result } = renderHook(() => useTeamGrantInbox("token", "chair", true));
  await waitFor(() => expect(result.current.error).toBe("Нет связи"));
  expect(result.current.launches).toBeUndefined();
  expect(result.current.reviews).toBeUndefined();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.launches).toEqual([]));
  expect(result.current.error).toBeUndefined();
});
