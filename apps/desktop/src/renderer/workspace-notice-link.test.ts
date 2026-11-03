import { expect, it } from "vitest";
import { workspaceNoticeId, withoutWorkspaceNotice } from "./workspace-notice-link";

it("accepts only one opaque UUID and keeps the link across a login screen", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  expect(workspaceNoticeId(`?workspaceNotice=${id}`)).toBe(id);
  expect(workspaceNoticeId("")).toBeUndefined();
  expect(() => workspaceNoticeId("?workspaceNotice=https://other.invalid/")).toThrow();
  expect(() => workspaceNoticeId(`?workspaceNotice=${id}&workspaceNotice=${id}`)).toThrow();
  expect(withoutWorkspaceNotice(`https://workspace.invalid/?other=keep&workspaceNotice=${id}#context`)).toBe("/?other=keep#context");
});
