import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalsView } from "./ApprovalsView";

function Surface() {
  return <ApprovalsView token="qa-only" canManage={false} canCreateRequest={false} currentUserId="qa" people={[]} positions={[]} requests={[]} calendarEvents={[]} attachments={[]}
    onSaveWorkflow={vi.fn()} onPublishWorkflow={vi.fn()} onCreateRequest={vi.fn()} onAction={vi.fn()} onDeleteRequest={vi.fn()} onReviseRequest={vi.fn()} onUploadAttachments={vi.fn()} onDownloadAttachment={vi.fn()} />;
}
afterEach(cleanup);
describe("Payment board input integration", () => {
  it("attaches wheel handling after switching list back to Kanban and leaves middle clicks native", () => {
    render(<Surface />);
    const board = screen.getByRole("region", { name: "Доска заявок по стадиям" });
    expect(board).toHaveAttribute("tabindex", "0");
    Object.defineProperties(board, { clientWidth: { value: 400 }, scrollWidth: { value: 1400 } });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
    fireEvent(board, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(board.scrollLeft).toBe(80);
    const middle = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    fireEvent(board, middle);
    expect(middle.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.queryByRole("region", { name: "Доска заявок по стадиям" })).toBeNull();
    const detachedWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
    fireEvent(board, detachedWheel);
    expect(detachedWheel.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Канбан" }));
    const next = screen.getByRole("region", { name: "Доска заявок по стадиям" });
    Object.defineProperties(next, { clientWidth: { value: 400 }, scrollWidth: { value: 1400 } });
    fireEvent.wheel(next, { deltaY: 50 });
    expect(next.scrollLeft).toBe(50);
  });
});
