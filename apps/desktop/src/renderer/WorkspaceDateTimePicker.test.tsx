import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";

describe("workspace date and file inputs", () => {
  afterEach(cleanup);

  it("opens the shared calendar and uses 24-hour time by default", () => {
    const change = vi.fn();
    render(<WorkspaceDateTimePicker ariaLabel="Срок" value="2026-09-27T09:15" onChange={change} />);

    fireEvent.click(screen.getByRole("button", { name: "Срок: открыть выбор" }));
    expect(screen.getByRole("group", { name: "Формат времени" })).toBeVisible();
    expect(screen.getByRole("button", { name: "24" })).toHaveAttribute("aria-pressed", "true");

    const minutes = screen.getByRole("listbox", { name: "Минуты" });
    fireEvent.click(within(minutes).getByRole("option", { name: "30" }));
    expect(change).toHaveBeenCalledWith("2026-09-27T09:30");
  });

  it("switches compactly to a 12-hour wheel", () => {
    render(<WorkspaceDateTimePicker ariaLabel="Время" mode="time" value="15:00" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Время: открыть выбор" }));
    fireEvent.click(screen.getByRole("button", { name: "12" }));
    expect(screen.getByRole("button", { name: "12" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Половина дня" })).toBeVisible();
  });

  it("accepts dropped files through the shared upload surface", () => {
    const onFiles = vi.fn();
    const file = new File(["document"], "proposal.docx");
    const { container } = render(<WorkspaceFileDropzone label="Документ" hint="DOCX" actionLabel="Выбрать" onFiles={onFiles} />);
    const zone = container.querySelector(".ws-file-dropzone");
    expect(zone).not.toBeNull();
    fireEvent.drop(zone!, { dataTransfer: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
