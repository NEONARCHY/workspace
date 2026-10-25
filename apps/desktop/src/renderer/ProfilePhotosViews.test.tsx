import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsView } from "./ApprovalsView";
import { TripApprovalsView } from "./TripApprovalsView";
import { TeamDashboardView } from "./TeamDashboardView";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { workspaceTheme } from "./workspace-theme";
import * as api from "./workspace-api";
import { photoPayment, photoPeople, photoTasks, photoTrip } from "./test-fixtures/profile-photo-scenarios";

vi.mock("./TeamPresencePanel", () => ({ TeamPresencePanel: () => null }));

beforeEach(() => {
  vi.spyOn(api, "loadProfileAvatar").mockResolvedValue(new Blob(["photo"], { type: "image/png" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:person-photo");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function payments(focusRequestId?: string) {
  const openProfile = vi.fn();
  const view = render(<FluentProvider theme={workspaceTheme}><EmployeeProfileProvider onOpenProfile={openProfile}>
    <ApprovalsView token="photo-token" focusRequestId={focusRequestId} currentUserId="initials-employee"
      canManage={false} canCreateRequest={false} isSuperadmin={false} people={photoPeople} positions={[]}
      requests={[photoPayment]} calendarEvents={[]} attachments={[]} onSaveWorkflow={vi.fn()} onPublishWorkflow={vi.fn()}
      onCreateRequest={vi.fn()} onAction={vi.fn()} onDeleteRequest={vi.fn()} onReviseRequest={vi.fn()}
      onUploadAttachments={vi.fn()} onDownloadAttachment={vi.fn()} />
  </EmployeeProfileProvider></FluentProvider>);
  return { ...view, openProfile };
}

async function expectPhoto(container: Element) {
  await waitFor(() => expect(container.querySelector(".fui-Avatar__image")).toHaveAttribute("src", "blob:person-photo"));
}

describe("profile photos across process and team views", () => {
  it("uses the protected photo on payment cards and list rows without opening the request on a profile click", async () => {
    const view = payments();
    const cardPerson = view.container.querySelector(".approval-card-owner")!;
    await expectPhoto(cardPerson);
    fireEvent.keyDown(cardPerson, { key: "Enter" });
    expect(view.openProfile).toHaveBeenCalledWith("photo-employee");
    expect(screen.queryByRole("button", { name: "Закрыть карточку заявки" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    await expectPhoto(view.container.querySelector(".process-record-person")!);
    expect(api.loadProfileAvatar).toHaveBeenCalledWith("photo-token", "photo-employee", "photo-v1");
  });

  it("shows both people in payment details, with initials for an initiator without a photo", async () => {
    payments(photoPayment.id);
    const peopleSection = screen.getByRole("heading", { name: "Ответственные" }).closest("section")!;
    const responsible = within(peopleSection).getByRole("button", { name: "Открыть профиль: Дилшод Рахимов" });
    await expectPhoto(responsible);
    const initiator = within(peopleSection).getByRole("button", { name: "Открыть профиль: Азиза Каримова" });
    expect(within(initiator).getByText("АК")).toBeInTheDocument();
    expect(initiator.querySelector(".fui-Avatar__image")).toBeNull();
  });

  it("uses profile photos in attention, workload and task context while keeping the workload action", async () => {
    const view = render(<FluentProvider theme={workspaceTheme}><TeamDashboardView token="photo-token" tasks={photoTasks}
      people={photoPeople} currentUserId="initials-employee" efficiencyLoading={false} onSelectTask={vi.fn()} /></FluentProvider>);
    await expectPhoto(view.container.querySelector(".team-dash-task-person")!);
    const workload = screen.getByRole("button", { name: /Посмотреть нагрузку: Дилшод Рахимов/ });
    await expectPhoto(workload);
    fireEvent.click(workload);
    expect(screen.getByRole("dialog", { name: "Нагрузка: Дилшод Рахимов" })).toBeInTheDocument();
  });

  it("loads trip requester and participant photos and leaves initials for a participant without a photo", async () => {
    const view = render(<FluentProvider theme={workspaceTheme}><TripApprovalsView token="photo-token" requests={[photoTrip]}
      people={photoPeople} currentUser={photoPeople[0]!} onCreate={vi.fn()} onUpdate={vi.fn()} onAction={vi.fn()} /></FluentProvider>);
    await expectPhoto(view.container.querySelector(".approval-card-owner")!);
    fireEvent.click(screen.getByRole("button", { name: /Открыть поездку/ }));
    await expectPhoto(document.querySelector(".trip-detail .trip-person")!);
    const participant = document.querySelectorAll<HTMLElement>(".trip-employee-link");
    await expectPhoto(participant[0]!);
    expect(within(participant[1]!).getByText("АК")).toBeInTheDocument();
    expect(api.loadProfileAvatar).not.toHaveBeenCalledWith(expect.anything(), "initials-employee", expect.anything());
  });
  it("keeps initials and makes no photo request when trips have no authenticated session", () => {
    const view = render(<FluentProvider theme={workspaceTheme}><TripApprovalsView requests={[photoTrip]}
      people={photoPeople} currentUser={photoPeople[0]!} onCreate={vi.fn()} onUpdate={vi.fn()} onAction={vi.fn()} /></FluentProvider>);
    const requester = view.container.querySelector<HTMLElement>(".approval-card-owner")!;
    expect(within(requester).getByText("ДР")).toBeInTheDocument();
    expect(requester.querySelector(".fui-Avatar__image")).toBeNull();
    expect(api.loadProfileAvatar).not.toHaveBeenCalled();
  });
});
