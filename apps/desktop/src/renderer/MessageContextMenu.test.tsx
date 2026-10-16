import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageContextMenu } from "./MessageContextMenu";

describe("MessageContextMenu layout", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("clamps the combined reaction strip and actions, then repositions on resize", () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 480);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(304);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
    render(<MessageContextMenu x={310} y={470} portalContainer={document.body} onPointerDown={(event) => event.stopPropagation()} autoFocus
      accessory={<div role="group" aria-label="Quick"><button type="button">Emoji</button></div>}>
      <button type="button">Reply</button>
    </MessageContextMenu>);
    const stack = screen.getByRole("menu").parentElement!;
    expect(stack).toHaveClass("message-context-stack");
    expect(stack).toHaveStyle({ left: "8px", top: "72px", maxWidth: "304px", maxHeight: "464px" });
    expect(screen.getByRole("button", { name: "Emoji" })).toHaveFocus();
    vi.stubGlobal("innerWidth", 640);
    vi.stubGlobal("innerHeight", 768);
    fireEvent(window, new Event("resize"));
    expect(stack).toHaveStyle({ left: "310px", top: "360px" });
  });

  it("keeps wrapped action labels left-aligned and icons in a fixed column", () => {
    const css = readFileSync("src/renderer/workspace-2-messenger.css", "utf8");
    expect(css).toMatch(/html body \.message-context-menu \.fui-Button \{[^}]*justify-content: flex-start;[^}]*text-align: left;/);
    expect(css).toMatch(/html body \.message-context-menu \.fui-Button__icon \{[^}]*flex: 0 0 20px;/);
  });

  it("keeps the original single-surface dialog when there is no accessory", () => {
    render(<MessageContextMenu x={20} y={30} portalContainer={document.body} onPointerDown={vi.fn()} label="People">People</MessageContextMenu>);
    expect(screen.getByRole("dialog", { name: "People" })).toHaveClass("message-context-menu");
    expect(screen.getByRole("dialog", { name: "People" })).toHaveFocus();
    expect(document.querySelector(".message-context-stack")).not.toBeInTheDocument();
  });
});
