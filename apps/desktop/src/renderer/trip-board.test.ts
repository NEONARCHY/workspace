import { describe, expect, it } from "vitest";
import type { TripRequest, TripStage } from "@yuksalish/contracts";
import { tripColumns, tripColumnTotal, tripDropAction } from "./trip-board";

describe("Trip board", () => {
  it("uses the five exact Bitrix stages and colours in order", () => {
    expect(tripColumns).toEqual([
      { key: "launch", label: "Запуск", color: "#72b9dc" },
      { key: "manager_approval", label: "Утверждение руководителем", color: "#849fd0" },
      { key: "hr", label: "Кадровая служба", color: "#50bec8" },
      { key: "approved", label: "Утверждено", color: "#62bd72" },
      { key: "rejected", label: "Отклонено", color: "#d97878" },
    ]);
  });
  it("proposes only adjacent forward actions, return and rejection; never revives a final stage", () => {
    const allowed: Record<TripStage, Partial<Record<TripStage, string>>> = {
      launch: { manager_approval: "submit" },
      manager_approval: { hr: "approve", launch: "return", rejected: "reject" },
      hr: { approved: "approve", launch: "return", rejected: "reject" },
      approved: {}, rejected: {},
    };
    for (const from of tripColumns) for (const to of tripColumns) {
      expect(tripDropAction({ stage: from.key, status: "running", allowedActions: ["submit", "resubmit", "approve", "return", "reject"] }, to.key))
        .toBe(allowed[from.key][to.key]);
    }
  });
  it("uses resubmit for the correction cycle", () => {
    expect(tripDropAction({ stage: "launch", status: "needs_revision", allowedActions: ["resubmit"] }, "manager_approval")).toBe("resubmit");
    expect(tripDropAction({ stage: "launch", status: "needs_revision", allowedActions: ["submit"] }, "manager_approval")).toBeUndefined();
  });
  it("never grants an action absent from the server response", () => {
    for (const from of tripColumns) for (const to of tripColumns) {
      expect(tripDropAction({ stage: from.key, status: "running", allowedActions: [] }, to.key)).toBeUndefined();
    }
  });
  it("distinguishes an empty column from an unknown budget", () => {
    expect(tripColumnTotal([])).toBe("0 UZS");
    expect(tripColumnTotal([{} as TripRequest])).toBe("Не задана");
  });
});
