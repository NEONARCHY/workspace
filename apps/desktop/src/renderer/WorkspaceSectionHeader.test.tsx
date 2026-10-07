import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sectionHeaderMotifs, WorkspaceSectionHeader } from "./WorkspaceSectionHeader";

afterEach(cleanup);

describe("WorkspaceSectionHeader", () => {
  it("preserves the heading, labelled region and working actions", () => {
    const create = vi.fn();
    const { container } = render(<WorkspaceSectionHeader motif="tasks" className="section-toolbar" aria-labelledby="title">
      <div><h1 id="title">Задачи</h1><p>Карточки, команда, сроки и зависимости</p></div>
      <button type="button" onClick={create}>Новая задача</button>
    </WorkspaceSectionHeader>);
    expect(screen.getByRole("heading", { name: "Задачи", level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новая задача" }));
    expect(create).toHaveBeenCalledOnce();
    expect(container.querySelector("header")).toHaveAttribute("aria-labelledby", "title");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toHaveAttribute("focusable", "false");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("gives each module a distinct, static drawing without interactive decorations", () => {
    const motifs = Object.entries(sectionHeaderMotifs);
    expect(new Set(motifs.map(([, path]) => path)).size).toBe(motifs.length);
    const { container } = render(<>{motifs.map(([motif]) => <WorkspaceSectionHeader
      key={motif} motif={motif as keyof typeof sectionHeaderMotifs}><h1>{motif}</h1></WorkspaceSectionHeader>)}</>);
    expect(container.querySelectorAll("header")).toHaveLength(motifs.length);
    expect(container.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(motifs.length);
    expect(container.querySelectorAll("button, animate, animateTransform")).toHaveLength(0);
  });
});
