import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "@yuksalish/contracts";
import { ProcessWorkflowDesigner } from "./ProcessWorkflowDesigner";

const workflow: WorkflowDefinition = {
  id: "project-draft",
  name: "Маршрут проектов",
  version: 2,
  status: "draft",
  formSchema: { process: "project" },
  nodes: [
    { id: "start", kind: "start", label: "Начало", detail: "Старт", positionX: 0, positionY: 0, config: {} },
    { id: "success", kind: "end", label: "Успех", detail: "Финиш", positionX: 260, positionY: 0, config: {} },
  ],
  edges: [{ id: "edge", source: "start", target: "success", outcome: "approve", condition: {}, sortOrder: 0 }],
};

afterEach(cleanup);

describe("ProcessWorkflowDesigner", () => {
  it("saves edits only through the workflow passed to this designer", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProcessWorkflowDesigner workflow={workflow} processName="Маршрут проектов" accent="project" onSave={onSave} onPublish={vi.fn()} />);

    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Регистрация" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-draft",
      formSchema: { process: "project" },
      nodes: expect.arrayContaining([expect.objectContaining({ id: "start", label: "Регистрация" })]),
    }));
  });
});
