import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";

afterEach(cleanup);
const props = { label: "Добавить файл", hint: "Выберите файл", actionLabel: "Выбрать", onFiles: vi.fn() };
describe("File dropzone focus modality", () => {
  it("highlights file drops, clears feedback and blocks disabled drops", () => {
    const onFiles = vi.fn();
    const { rerender } = render(<WorkspaceFileDropzone {...props} multiple onFiles={onFiles} />);
    const zone = screen.getByLabelText("Добавить файл").closest("label")!;
    const files = [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")];
    const dataTransfer = { files, types: ["Files"], dropEffect: "none" };
    fireEvent.dragOver(zone, { dataTransfer });
    expect(zone).toHaveClass("is-dragging");
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass("is-dragging");
    fireEvent.dragOver(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });
    expect(zone).not.toHaveClass("is-dragging");
    expect(onFiles).toHaveBeenCalledWith(files);
    rerender(<WorkspaceFileDropzone {...props} multiple disabled onFiles={onFiles} />);
    fireEvent.dragOver(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });
    expect(zone).not.toHaveClass("is-dragging");
    expect(onFiles).toHaveBeenCalledTimes(1);
  });
  it("can delegate the selected-file list to its parent without duplicate names", () => {
    const file = new File(["a"], "a.pdf");
    const { rerender } = render(<WorkspaceFileDropzone {...props} files={[file]} />);
    expect(screen.getByText(file.name)).toBeInTheDocument();
    rerender(<WorkspaceFileDropzone {...props} files={[file]} showSelectedFiles={false} />);
    expect(screen.queryByText(file.name)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Добавить файл")).not.toBeDisabled();
  });
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
