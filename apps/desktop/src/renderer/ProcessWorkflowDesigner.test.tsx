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

  it("uses the full graph editor while preserving an independent trip template", async () => {
    const tripWorkflow: WorkflowDefinition = { ...workflow, id: "trip-draft", name: "Маршрут поездок", formSchema: { process: "trip" } };
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProcessWorkflowDesigner workflow={tripWorkflow} processName="Маршрут поездок" accent="trip" onSave={onSave} onPublish={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Условие" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Параллельные ветки" })).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Старт поездки" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "trip-draft", formSchema: { process: "trip" } }));
  });

  it("saves a pastel stage colour and marks colours used by another stage", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const coloredWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.id === "success"
        ? { ...node, config: { stageColor: "#73bf9b" } }
        : node),
    };
    render(<ProcessWorkflowDesigner workflow={coloredWorkflow} processName="Маршрут проектов" accent="project" onSave={onSave} onPublish={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Мятный, уже используется: 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Небесный, свободен" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "start", config: expect.objectContaining({ stageColor: "#72b9dc" }) }),
      ]),
    }));
  });
});
