import { describe, expect, it } from "vitest";
import {
  approvalCardStatusPresentation,
  approvalColumnTotals,
  approvalDeadlinePresentation,
  approvalRequestIsOverdue,
  approvalRequestNeedsAction,
  approvalStagePalette,
  paymentStageColors,
} from "./approval-board";

const text = (value: string) => value.replace(/\u00a0|\u202f/g, " ");
const totals = (items: readonly { amount: number; currency: string }[]) => approvalColumnTotals(items).map((item) => text(item.formatted));

describe("Payment board colours and totals", () => {
  it("uses all 13 exact colours read from the Bitrix payment stages", () => {
    expect(paymentStageColors).toEqual({
      start: "#f26b47", project_financier: "#f78d4d", finance_manager_projects: "#fdb051",
      members: "#fff55a", chair_assistant: "#7bc56f", chief_accountant: "#abd46c",
      deputy_chair: "#00bbb4", chair: "#00bef6", awaiting_payment: "#f16ca8",
      payment: "#a5de00", correction: "#6b52cc", completed: "#00ff00", cancelled: "#ff0000",
    });
  });
  it("keeps a stage colour after renaming and has fallbacks for custom nodes", () => {
    expect(approvalStagePalette({ key: "chair", label: "Новое название", kind: "approval" }).background).toBe("#00bef6");
    expect(approvalStagePalette({ key: "custom", label: "Доработать", kind: "correction" }).background).toBe("#6b52cc");
    expect(approvalStagePalette({ key: "custom", label: "Отклонено", kind: "end" }).background).toBe("#ff0000");
    expect(approvalStagePalette({ key: "custom", label: "Проверка", kind: "approval" }).background).toBe("#dbe8f5");
    expect(approvalStagePalette({ key: "chair", label: "Председатель", kind: "approval", color: "#72b9dc" }).background).toBe("#72b9dc");
  });
  it("keeps small header text readable on each exact stage colour", () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
        .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
    };
    for (const key of Object.keys(paymentStageColors)) {
      const palette = approvalStagePalette({ key, kind: "approval", label: key });
      const a = luminance(palette.background), b = luminance(palette.foreground);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("shows zero for an empty column", () => expect(totals([])).toEqual(["0 UZS"]));
  it("adds fractional amounts without floating-point display artefacts", () => {
    expect(totals([{ amount: 25000000, currency: "UZS" }, { amount: 19.01, currency: "UZS" }, { amount: .09, currency: "UZS" }]))
      .toEqual(["25 000 019,10 UZS"]);
    expect(totals([{ amount: .1, currency: "UZS" }, { amount: .2, currency: "UZS" }])).toEqual(["0,30 UZS"]);
  });
  it("does not combine or convert currencies", () => {
    expect(totals([{ amount: 10, currency: "usd" }, { amount: 25000, currency: "UZS" }, { amount: .5, currency: " USD " }, { amount: 4, currency: "EUR" }]))
      .toEqual(["25 000 UZS", "4 EUR", "10,50 USD"]);
  });
  it("preserves cents when aggregate minor units exceed the safe integer range", () => {
    expect(totals(Array.from({ length: 100 }, () => ({ amount: 999999999999.99, currency: "UZS" }))))
      .toEqual(["99 999 999 999 999 UZS"]);
  });
  it("flags invalid data without crashing or silently showing a partial total", () => {
    expect(totals([{ amount: 100, currency: "UZS" }, { amount: Number.NaN, currency: "UZS" }, { amount: 5, currency: "UZS" }]))
      .toEqual(["Проверьте сумму (UZS)"]);
  });
});

describe("Payment request deadline presentation", () => {
  const request = (deadline: string) => ({
    status: "running" as const,
    details: { deadline },
  });

  it("distinguishes normal, approaching and urgent deadlines", () => {
    const now = new Date("2026-09-08T08:00:00Z");
    expect(approvalDeadlinePresentation(request("2026-09-10T08:00:00Z"), now).tone)
      .toBe("neutral");
    expect(approvalDeadlinePresentation(request("2026-09-09T07:00:00Z"), now).tone)
      .toBe("attention");
    expect(approvalDeadlinePresentation(request("2026-09-08T09:00:00Z"), now).tone)
      .toBe("urgent");
  });

  it("shows overdue duration and stops control for a finished request", () => {
    const now = new Date("2026-09-08T08:00:00Z");
    expect(approvalDeadlinePresentation(request("2026-09-07T08:00:00Z"), now).label)
      .toContain("Просрочено");
    expect(approvalDeadlinePresentation({
      status: "approved",
      details: { deadline: "2026-09-07T08:00:00Z" },
    }, now)).toMatchObject({ tone: "success", label: "Завершена" });
  });
});

describe("Payment request card status", () => {
  const request = (overrides: Partial<{
    status: "running" | "needs_revision" | "approved" | "rejected" | "cancelled";
    statusLabel: string;
    requesterId: string;
    canAct: boolean;
    deadline: string | null;
  }> = {}) => ({
    status: overrides.status ?? "running",
    statusLabel: overrides.statusLabel ?? "Ожидает решения",
    requesterId: overrides.requesterId ?? "owner",
    activeStages: [{ canAct: overrides.canAct ?? false }],
    deadlineControl: undefined,
    details: { deadline: overrides.deadline ?? null },
  });

  it("prioritizes overdue and revision states over generic workflow text", () => {
    const now = new Date("2026-09-08T08:00:00Z");
    expect(approvalCardStatusPresentation(request({
      canAct: true,
      deadline: "2026-09-06T08:00:00Z",
    }), "reviewer", now)).toMatchObject({ tone: "overdue", label: "Просрочено на 2 дн." });
    expect(approvalCardStatusPresentation(request({ status: "needs_revision" }), "owner", now))
      .toEqual({ tone: "revision", label: "Требует доработки" });
  });

  it("explains personal action and finished outcomes with text", () => {
    expect(approvalCardStatusPresentation(request({ canAct: true }), "reviewer"))
      .toEqual({ tone: "action", label: "Нужно ваше решение" });
    expect(approvalCardStatusPresentation(request({
      status: "approved",
      statusLabel: "Согласовано",
    }), "reviewer")).toEqual({ tone: "success", label: "Согласовано" });
    expect(approvalCardStatusPresentation(request({
      status: "cancelled",
      statusLabel: "Отменено",
    }), "reviewer")).toEqual({ tone: "danger", label: "Отменено" });
  });
});

describe("Payment board actionable summary", () => {
  const stage = (canAct: boolean) => ({ canAct });

  it("counts a decision only for the person who can act", () => {
    expect(approvalRequestNeedsAction({ status: "running", requesterId: "owner", activeStages: [stage(false), stage(true)] }, "reviewer")).toBe(true);
    expect(approvalRequestNeedsAction({ status: "running", requesterId: "owner", activeStages: [stage(false)] }, "reviewer")).toBe(false);
    expect(approvalRequestNeedsAction({ status: "approved", requesterId: "owner", activeStages: [stage(true)] }, "reviewer")).toBe(false);
  });

  it("includes the requester in correction without claiming a finished request needs action", () => {
    const correction = { status: "needs_revision" as const, requesterId: "owner", activeStages: [stage(false)] };
    expect(approvalRequestNeedsAction(correction, "owner")).toBe(true);
    expect(approvalRequestNeedsAction(correction, "someone-else")).toBe(false);
  });

  it("counts actual overdue requests, not merely urgent upcoming deadlines", () => {
    const now = new Date("2026-09-08T08:00:00Z");
    expect(approvalRequestIsOverdue({ status: "running", details: { deadline: "2026-09-08T07:00:00Z" } }, now)).toBe(true);
    expect(approvalRequestIsOverdue({ status: "running", details: { deadline: "2026-09-08T09:00:00Z" } }, now)).toBe(false);
    expect(approvalRequestIsOverdue({ status: "approved", details: { deadline: "2026-09-08T07:00:00Z" } }, now)).toBe(false);
  });
});
