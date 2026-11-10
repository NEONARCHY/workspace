import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalRequestSummary, WorkspaceAttachment } from "@yuksalish/contracts";
import { ApprovalsView } from "./ApprovalsView";
import { workspaceTheme } from "./workspace-theme";
import { photoPayment, photoPeople } from "./test-fixtures/profile-photo-scenarios";

const files: WorkspaceAttachment[] = (["primary", "additional"] as const).map((role, index) => ({
  id: `file-${index}`, ownerType: "approval_request", ownerId: photoPayment.id,
  fileName: `${role}.pdf`, contentType: "application/pdf", byteSize: 1024,
  sha256: "a".repeat(64), uploadedByUserId: "another-uploader",
  documentRole: role, createdAt: photoPayment.createdAt,
}));

function setup(request = photoPayment, currentUserId = request.requesterId,
  remove: (attachment: WorkspaceAttachment) => Promise<void> = vi.fn(async () => {}), isSuperadmin = false) {
  function Surface() {
    const [attachments, setAttachments] = useState(files);
    return <FluentProvider theme={workspaceTheme}><ApprovalsView token=""
      canManage={false} canCreateRequest={false} isSuperadmin={isSuperadmin} currentUserId={currentUserId}
      people={photoPeople} positions={[]} requests={[request]} calendarEvents={[]} attachments={attachments}
      focusRequestId={request.id} onSaveWorkflow={vi.fn()} onPublishWorkflow={vi.fn()}
      onCreateRequest={vi.fn()} onAction={vi.fn()} onDeleteRequest={vi.fn()} onReviseRequest={vi.fn()}
      onUploadAttachments={vi.fn()} onDownloadAttachment={vi.fn()} onDeleteAttachment={async file => {
        await remove(file);
        setAttachments(current => current.filter(item => item.id !== file.id));
      }} /></FluentProvider>;
  }
  render(<Surface />);
  fireEvent.click(screen.getByRole("button", { name: "Файлы" }));
  return remove;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Payment files", () => {
  it.each(["primary", "additional"])("confirms removal of a %s document and preserves other files", async role => {
    const remove = setup();
    fireEvent.click(screen.getByRole("button", { name: `Удалить файл: ${role}.pdf` }));
    const confirmation = screen.getByRole("dialog", { name: "Удалить файл?" });
    expect(confirmation).toHaveTextContent(`Файл «${role}.pdf» исчезнет из вложений.`);
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: `Удалить файл: ${role}.pdf` })).not.toBeInTheDocument());
    expect(remove).toHaveBeenCalledExactlyOnceWith(files.find(file => file.documentRole === role));
    expect(screen.getByRole("button", { name: `Удалить файл: ${role === "primary" ? "additional" : "primary"}.pdf` })).toBeInTheDocument();
  });
  it("keeps files when the confirmation is cancelled", () => {
    const remove = setup();
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл: primary.pdf" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Удалить файл?" })).getByRole("button", { name: "Отмена" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Удалить файл: primary.pdf" })).toBeInTheDocument();
  });
  it("keeps the file and offers a retry when the server rejects removal", async () => {
    const remove = vi.fn(async () => { throw new Error("Нет права удалить файл"); });
    setup(photoPayment, photoPayment.requesterId, remove);
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл: primary.pdf" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Удалить файл?" })).getByRole("button", { name: "Удалить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет права удалить файл");
    expect(screen.getByRole("button", { name: "Удалить файл: primary.pdf" })).toBeEnabled();
  });
  it("disables repeat deletion while waiting for the server", async () => {
    let finish!: () => void;
    const remove = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    setup(photoPayment, photoPayment.requesterId, remove);
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл: primary.pdf" }));
    const button = within(screen.getByRole("dialog", { name: "Удалить файл?" })).getByRole("button", { name: "Удалить" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Удаляем…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Удалить файл: additional.pdf" })).toBeEnabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Удалить файл: primary.pdf" })).not.toBeInTheDocument());
  });
  it.each(["approved", "rejected", "cancelled"] as const)("keeps a %s request read-only even for a superadmin", status => {
    setup({ ...photoPayment, status }, photoPayment.requesterId, undefined, true);
    expect(screen.queryByRole("button", { name: /^Удалить файл:/ })).not.toBeInTheDocument();
  });
  it("does not give a viewer deletion rights through their approval assignment", () => {
    setup({ ...photoPayment, activeStages: photoPayment.activeStages.map(stage => ({ ...stage, canAct: true })) }, "viewer");
    expect(screen.queryByRole("button", { name: /^Удалить файл:/ })).not.toBeInTheDocument();
  });
  it("lets a designated correction editor remove outdated documents", () => {
    const returned: ApprovalRequestSummary = { ...photoPayment, status: "needs_revision",
      activeStages: [{ key: "correction", label: "Доработка", kind: "correction", canAct: true }] };
    setup(returned, "correction-editor");
    expect(screen.getAllByRole("button", { name: /^Удалить файл:/ })).toHaveLength(2);
  });
});
