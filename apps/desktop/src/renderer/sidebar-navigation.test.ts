import { describe, expect, it } from "vitest";
import { navigationKeys } from "@yuksalish/contracts";
import { visibleNavigation } from "./personal-organization";

describe("sidebar presentation", () => {
  it("restores payment requests and preserves the personal order", () => {
    const order = ["payment_requests", ...navigationKeys.filter((key) => key !== "payment_requests")] as const;
    expect(visibleNavigation(order)[0]).toBe("payment_requests");
    expect(visibleNavigation(order)).not.toContain("projects");
  });
  it("filters hidden and unauthorized items independently and restores hidden items", () => {
    const visible = visibleNavigation(navigationKeys, ["feed", "payment_requests"], (key) => key !== "hr");
    for (const key of ["feed", "payment_requests", "hr"]) expect(visible).not.toContain(key);
    const hidden = visibleNavigation(navigationKeys, ["ai_referent", "notifications"]);
    expect(hidden).not.toContain("ai_referent"); expect(hidden).not.toContain("notifications");
    expect(hidden).toContain("ai_hisobot");
    expect(visibleNavigation(navigationKeys)).toContain("payment_requests");
    expect(visibleNavigation(navigationKeys, undefined)).toContain("payment_requests");
  });
});
