import { describe, expect, it } from "vitest";
import type { TripRequest, TripStage, WorkflowDefinition } from "@yuksalish/contracts";
import { currentTripWorkflow, tripColumns, tripColumnTotal, tripDropAction } from "./trip-board";

describe("Trip board", () => {
  it("shows the deputy and chair route without a кадровая-служба column", () => {
    expect(tripColumns).toEqual([
      { key: "launch", label: "Запуск", color: "#72b9dc" },
      { key: "deputy_approval", label: "Согласование первого заместителя", color: "#50bec8" },
      { key: "manager_approval", label: "Утверждение председателем", color: "#849fd0" },
      { key: "approved", label: "Утверждено", color: "#62bd72" },
      { key: "rejected", label: "Отклонено", color: "#d97878" },
    ]);
  });
  it("proposes only adjacent forward actions, return and rejection; never revives a final stage", () => {
    const allowed: Record<TripStage, Partial<Record<TripStage, string>>> = {
      launch: { manager_approval: "submit" },
      deputy_approval: {},
      manager_approval: { launch: "return", rejected: "reject" },
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
  it("routes new trips straight from the chair to approval without an HR bypass", () => {
    const request = { workflowVersion: 2, stage: "manager_approval" as const,
      status: "running" as const, allowedActions: ["approve" as const] };
    expect(tripDropAction(request, "approved")).toBe("approve");
    expect(tripDropAction(request, "deputy_approval")).toBeUndefined();
    expect(tripDropAction(request, "approved", true)).toBe("approve");
  });
  it("requires the first deputy before the chair for v3 trips", () => {
    const launch = { workflowVersion: 3, stage: "launch" as const,
      status: "draft" as const, allowedActions: ["submit" as const] };
    expect(tripDropAction(launch, "deputy_approval")).toBe("submit");
    expect(tripDropAction(launch, "manager_approval")).toBeUndefined();
    const deputy = { ...launch, stage: "deputy_approval" as const,
      allowedActions: ["approve" as const] };
    expect(tripDropAction(deputy, "manager_approval")).toBe("approve");
    expect(tripDropAction(deputy, "approved")).toBeUndefined();
    expect(tripDropAction(deputy, "manager_approval", true)).toBe("approve");
  });
  it("updates the old editable graph without exposing the HR node", () => {
    const graph = { id: "trip", name: "Trips", version: 2, status: "draft", formSchema: {},
      nodes: ["launch", "manager_approval", "hr", "approved", "rejected"].map((id, index) => ({
        id, kind: id === "launch" ? "start" as const : "approval" as const,
        label: id, detail: "", positionX: index * 260, positionY: 120, config: {},
      })),
      edges: ["launch:manager_approval", "manager_approval:hr", "hr:approved"].map((pair, index) => {
        const [source, target] = pair.split(":");
        return { id: String(index), source: source!, target: target!, outcome: "approve", condition: {}, sortOrder: index };
      }),
    } satisfies WorkflowDefinition;
    const current = currentTripWorkflow(graph, []);
    expect(current.nodes.map((node) => node.id)).toContain("deputy_approval");
    expect(current.nodes.map((node) => node.id)).not.toContain("hr");
    expect(current.edges.map((edge) => `${edge.source}:${edge.target}`)).toEqual([
      "launch:deputy_approval", "deputy_approval:manager_approval", "manager_approval:approved",
    ]);
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
