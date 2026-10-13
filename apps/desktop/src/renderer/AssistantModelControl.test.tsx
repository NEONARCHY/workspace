import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { AssistantModel } from "@yuksalish/contracts";
import { AssistantModelControl } from "./AssistantModelControl";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
it("opens only on request and maps exactly three positions to valid models", () => {
  const changed = vi.fn();
  function Controlled() {
    const [model, setModel] = useState<AssistantModel>("flash-lite");
    return <AssistantModelControl value={model} onChange={next => { setModel(next); changed(next); }} />;
  }
  render(<FluentProvider theme={workspaceTheme}><Controlled /></FluentProvider>);
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Выбрать мощность модели" }));
  const slider = screen.getByRole("slider", { name: "Мощность модели" });
  expect(slider).toHaveValue("0");
  expect(document.querySelector(".assistant-model-heading")).toHaveTextContent(/^Мощность модели$/);
  expect(slider).toHaveAttribute("step", "1");
  for (const [value, model, label] of [["1", "flash", "Средняя"], ["2", "pro", "Сильная"], ["0", "flash-lite", "Лёгкая"]]) {
    fireEvent.change(slider, { target: { value } });
    expect(changed).toHaveBeenLastCalledWith(model);
    expect(slider).toHaveAttribute("aria-valuetext", label);
  }
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
it("closes its own layer with Escape and restores focus, without bubbling", () => {
  const key = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><div onKeyDown={key}><AssistantModelControl value="pro" onChange={vi.fn()} /></div></FluentProvider>);
  const button = screen.getByRole("button", { name: "Выбрать мощность модели" });
  fireEvent.click(button);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(button).toHaveFocus();
  expect(key).not.toHaveBeenCalled();
});
it("cannot open or change selection while disabled", () => {
  const change = vi.fn();
  render(<AssistantModelControl value="flash-lite" onChange={change} disabled />);
  expect(screen.getByRole("button", { name: "Выбрать мощность модели" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Выбрать мощность модели" }));
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});
