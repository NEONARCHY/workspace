import { describe, expect, it } from "vitest";
import { isTaskOverdue, taskDeadlineTone } from "./task-deadline";

const now = new Date(2026, 9, 12, 23, 50).getTime();
const task = (days: number, hour = 9) => ({ status: "new" as const, dueAt: new Date(2026, 9, 12 + days, hour).toISOString() });

describe("Task deadline signals", () => {
  it("uses calendar days regardless of priority or remaining hours", () => {
    expect(taskDeadlineTone(task(3), now)).toBeUndefined();
    expect(taskDeadlineTone(task(2), now)).toBe("warning");
    expect(taskDeadlineTone(task(1), now)).toBe("danger");
    expect(taskDeadlineTone(task(0, 23), now)).toBe("danger");
    expect(taskDeadlineTone(task(-1), now)).toBe("danger");
  });
  it("keeps missing and invalid dates neutral, except an explicit overdue status", () => {
    for (const dueAt of [null, "", "invalid-date"]) {
      expect(taskDeadlineTone({ status: "new", dueAt }, now)).toBeUndefined();
      expect(isTaskOverdue({ status: "new", dueAt }, now)).toBe(false);
      expect(taskDeadlineTone({ status: "overdue", dueAt }, now)).toBe("danger");
    }
  });
  it("excludes completed and cancelled work, and includes overdue review deadlines", () => {
    for (const status of ["completed", "cancelled"] as const) {
      expect(taskDeadlineTone({ ...task(-2), status }, now)).toBeUndefined();
      expect(isTaskOverdue({ ...task(-2), status }, now)).toBe(false);
    }
    expect(isTaskOverdue({ ...task(-2), status: "awaiting_review" }, now)).toBe(true);
  });
  it("uses the exact deadline instant for overdue membership, including offsets", () => {
    const dueAt = "2026-10-12T18:30:00+05:00";
    const deadline = Date.parse(dueAt);
    expect(isTaskOverdue({ status: "in_progress", dueAt }, deadline - 1)).toBe(false);
    expect(isTaskOverdue({ status: "in_progress", dueAt }, deadline)).toBe(false);
    expect(isTaskOverdue({ status: "in_progress", dueAt }, deadline + 1)).toBe(true);
  });
  it("removes rescheduled work from overdue despite its historical status", () => {
    expect(isTaskOverdue({ ...task(3), status: "overdue" }, now)).toBe(false);
    expect(taskDeadlineTone({ ...task(3), status: "overdue" }, now)).toBeUndefined();
    expect(isTaskOverdue({ ...task(-1), status: "overdue" }, now)).toBe(true);
    const dueAt = new Date(now + 1).toISOString();
    expect(isTaskOverdue({ status: "overdue", dueAt }, now)).toBe(false);
    expect(isTaskOverdue({ status: "overdue", dueAt }, now + 2)).toBe(true);
  });
});
