import { expect, it } from "vitest";

import { tasksForPlan } from "./task-plan-filter";

it("filters by a plan without removing tasks shared with other plans", () => {
  const tasks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const plans = [
    { id: "work", taskIds: ["a", "b"] },
    { id: "regional", taskIds: ["b", "c"] },
  ];
  expect(tasksForPlan(tasks, plans, "work").map((task) => task.id)).toEqual(["a", "b"]);
  expect(tasksForPlan(tasks, plans, "regional").map((task) => task.id)).toEqual(["b", "c"]);
  expect(tasksForPlan(tasks, plans, "")).toBe(tasks);
  expect(tasksForPlan(tasks, plans, "unknown")).toEqual([]);
});
