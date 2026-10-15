import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Field, FluentProvider, Input } from "@fluentui/react-components";
import { observeFieldCaptionActivation } from "./field-caption-activation";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { workspaceTheme } from "./workspace-theme";
import { createPortal } from "react-dom";

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; cleanup(); });

describe("Non-activating field captions", () => {
  it("does not forward a wrapping caption click to a dropdown, but its button still opens", () => {
    stop = observeFieldCaptionActivation();
    render(<FluentProvider theme={workspaceTheme}><label><span>Состояние</span>
      <WorkspaceSelect aria-label="Состояние"><option value="all">Все состояния</option><option value="new">Не просмотрено</option></WorkspaceSelect>
    </label></FluentProvider>);
    fireEvent.click(screen.getByText("Состояние", { selector: "span" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Состояние" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("keeps Fluent Field accessible names without forwarding its separate label click", () => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><Field label="Поиск по номеру"><Input onClick={clicked} /></Field></FluentProvider>);
    const input = screen.getByRole("textbox", { name: "Поиск по номеру" });
    fireEvent.click(screen.getByText("Поиск по номеру", { selector: "label" }));
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(input);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it.each(["text", "search", "date", "number", "range"])("does not activate a caption for a native %s input", type => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(<><label htmlFor="field"><strong>Заголовок</strong></label><input id="field" type={type} onClick={clicked} /></>);
    fireEvent.click(screen.getByText("Заголовок"));
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(document.getElementById("field")!);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it.each(["checkbox", "radio", "file"])("preserves intentional %s label activation", type => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(<label>Выбрать<input type={type} onClick={clicked} /></label>);
    fireEvent.click(screen.getByText("Выбрать"));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("covers controls mounted later in a portal without removing the label association", () => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(createPortal(<><label htmlFor="portal-field">Описание</label>
      <textarea id="portal-field" onClick={clicked} /></>, document.body));
    fireEvent.click(screen.getByText("Описание"));
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("textbox", { name: "Описание" }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("prevents native select caption forwarding and leaves its own click alone", () => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(<label>Регион<select onClick={clicked}><option>Все регионы</option></select></label>);
    fireEvent.click(screen.getByText("Регион", { selector: "label" }));
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "Регион" }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("does not consume inline actions or toggle keyboard events and restores native behavior on cleanup", () => {
    stop = observeFieldCaptionActivation();
    const help = vi.fn(), clicked = vi.fn();
    render(<label>Название<button type="button" onClick={help}><span>Помощь</span></button><input aria-label="Название" onClick={clicked} /></label>);
    fireEvent.click(screen.getByText("Помощь"));
    expect(help).toHaveBeenCalledOnce();
    expect(clicked).not.toHaveBeenCalled();
    const input = screen.getByRole("textbox", { name: "Название" });
    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(true);
  });

  it("restores native caption activation when the observer is disposed", () => {
    stop = observeFieldCaptionActivation();
    const clicked = vi.fn();
    render(<label>Название<input onClick={clicked} /></label>);
    fireEvent.click(screen.getByText("Название", { selector: "label" }));
    expect(clicked).not.toHaveBeenCalled();
    stop(); stop = undefined;
    fireEvent.click(screen.getByText("Название", { selector: "label" }));
    expect(clicked).toHaveBeenCalledOnce();
  });
});
