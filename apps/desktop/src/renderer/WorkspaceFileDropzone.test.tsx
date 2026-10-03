import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";

afterEach(cleanup);
const props = { label: "Добавить файл", hint: "Выберите файл", actionLabel: "Выбрать", onFiles: vi.fn() };
describe("File dropzone focus modality", () => {
  it("shows a keyboard focus indicator only after Tab, never after pointer input", () => {
    render(<WorkspaceFileDropzone {...props} />);
    const input = screen.getByLabelText("Добавить файл");
    const zone = input.closest("label")!;
    fireEvent.pointerDown(zone);
    fireEvent.focus(input);
    expect(zone).not.toHaveAttribute("data-keyboard-focus");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(zone).toHaveAttribute("data-keyboard-focus", "true");
    fireEvent.pointerDown(document);
    expect(zone).not.toHaveAttribute("data-keyboard-focus");
  });
  it("keeps file selection and disabled behavior intact", () => {
    const onFiles = vi.fn();
    const { rerender } = render(<WorkspaceFileDropzone {...props} onFiles={onFiles} />);
    const file = new File(["contents"], "report.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Добавить файл"), { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    rerender(<WorkspaceFileDropzone {...props} disabled onFiles={onFiles} />);
    expect(screen.getByLabelText("Добавить файл")).toBeDisabled();
  });
});
