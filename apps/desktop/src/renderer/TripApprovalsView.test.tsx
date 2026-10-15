import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TripRequest } from "@yuksalish/contracts";
import { TripApprovalsView } from "./TripApprovalsView";
import { people } from "./test-fixtures/demo-data";
import type { FileViewerSource } from "./FileViewer";

vi.mock("./FileViewer", () => ({
  ExternalFileViewer: ({ attachment, onLoad, onClose }: {
    attachment: FileViewerSource;
    onLoad: (file: FileViewerSource, signal?: AbortSignal) => Promise<Blob>;
    onClose: () => void;
  }) => <div role="dialog" aria-label="Просмотр билдирги"><span>{attachment.fileName}</span>
    <button type="button" onClick={() => void onLoad(attachment, new AbortController().signal).then(onClose)}>Показать файл</button>
  </div>,
}));
vi.mock("./TripSignaturePad", () => ({
  TripSignaturePad: () => <div data-testid="signature-pad">Нарисуйте подпись</div>,
}));
vi.mock("./TripWorldMap", () => ({
  TripWorldMap: ({ requests, onClose }: { requests: readonly TripRequest[]; onClose: () => void }) =>
    <div data-testid="trip-map">Доступно поездок: {requests.length}<button type="button" onClick={onClose}>К поездкам</button></div>,
}));

const request: TripRequest = {
  id: "test-trip", number: "TR-TEST", requesterUserId: people[0]!.id,
  purpose: "Встреча с региональной командой", destination: "Самарканд", startDate: "2026-09-18", endDate: "2026-09-20",
  employeeIds: [people[0]!.id], stage: "manager_approval", stageLabel: "Утверждение руководителем",
  status: "running", statusLabel: "На согласовании", canEdit: false, allowedActions: ["approve", "return", "reject"],
  chatId: "trip-chat",
  actions: [], createdAt: "2026-09-04T09:00:00Z", updatedAt: "2026-09-04T09:00:00Z",
};
function setup(item = request, onAction = vi.fn(async () => undefined as TripRequest | undefined), currentUser = people[0]!, onOpenChat = vi.fn(), renderTripChat?: (trip: TripRequest) => React.ReactNode) {
  installSpatialGeometry();
  const onCreate = vi.fn(async () => undefined);
  render(<FluentProvider theme={webLightTheme}><TripApprovalsView requests={[item]} people={people} currentUser={currentUser} onCreate={onCreate} onUpdate={vi.fn()} onAction={onAction} onOpenChat={onOpenChat} renderTripChat={renderTripChat} /></FluentProvider>);
  return { onAction, onCreate, onOpenChat };
}
const column = (key: string) => document.querySelector(`.trip-column[data-stage-key="${key}"]`)!;
const card = () => document.querySelector(".trip-board-card")!;
async function drop(target: string) { await dropSpatialCard(card(), column(target)); }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("Trip approvals interaction", async () => {
  it("presents empty-board guidance as one readable status with a decorative icon", () => {
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[]} people={people} currentUser={people[0]!}
      onCreate={vi.fn()} onUpdate={vi.fn()} onAction={vi.fn()} /></FluentProvider>);
    const status = screen.getByText(/^Поездок пока нет/).closest(".workspace-notice")!;
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Поездок пока нет. Создайте первую командировку");
    expect(status.querySelector(":scope > svg")).toHaveAttribute("aria-hidden", "true");
    expect(status.querySelector(".workspace-notice-content")).toHaveTextContent("в колонке «Запуск»");
  });
  it("opens the map from the header and returns to trips", async () => {
    setup();
    const toggle = screen.getByRole("button", { name: "Интерактивная карта поездок" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(await screen.findByTestId("trip-map")).toHaveTextContent("Доступно поездок: 1");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "К поездкам" }));
    expect(screen.queryByTestId("trip-map")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Интерактивная карта поездок" })).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveFocus();
  });

  it("confirms soft deletion of an editable request before calling the API", async () => {
    installSpatialGeometry();
    const draft: TripRequest = {
      ...request, stage: "launch", stageLabel: "Запуск", status: "draft",
      statusLabel: "Черновик", canEdit: true, canDelete: true, allowedActions: ["submit"],
    };
    const onDelete = vi.fn(async () => undefined);
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[draft]} people={people} currentUser={people[0]!}
      onCreate={vi.fn()} onUpdate={vi.fn()} onAction={vi.fn()} onDelete={onDelete}
    /></FluentProvider>);
    fireEvent.click(card().querySelector(".approval-card-open")!);
    fireEvent.click(screen.getByRole("button", { name: "Удалить заявку" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Удалить заявку" }));
    fireEvent.click(screen.getByRole("button", { name: "Да, удалить" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(draft));
  });

  it("asks for a reason before withdrawing a sent request", async () => {
    installSpatialGeometry();
    const sent: TripRequest = {
      ...request, stage: "deputy_approval", stageLabel: "Согласование первого заместителя",
      workflowVersion: 3, allowedActions: ["withdraw"],
    };
    const onAction = vi.fn(async () => ({
      ...sent, stage: "launch" as const, status: "needs_revision" as const,
      allowedActions: ["resubmit" as const],
    }));
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[sent]} people={people} currentUser={people[0]!}
      onCreate={vi.fn()} onUpdate={vi.fn()} onAction={onAction}
    /></FluentProvider>);
    fireEvent.click(card().querySelector(".approval-card-open")!);
    fireEvent.click(screen.getByRole("button", { name: "Отозвать заявку" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Причина решения" }), {
      target: { value: "Нужно исправить даты" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(sent, "withdraw", "Нужно исправить даты"));
  });

  it("preserves the agreed trip participants and creates only after saving the actual form", async () => {
    const onCreate = vi.fn(async () => undefined);
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[]} people={people} currentUser={people[0]!}
      onCreate={onCreate} onUpdate={vi.fn()} onAction={vi.fn()}
      assistantDraft={{ kind: "trip", ready: true, fields: {
        purpose: "Рабочая встреча", destination: "Навои", startDate: "2030-10-01", endDate: "2030-10-02",
        employees: `${people[1]!.name}\n${people[2]!.name}`,
      } }} /></FluentProvider>);
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "", destination: "Навои", employeeIds: [people[1]!.id, people[2]!.id],
      startDate: "2030-10-01", endDate: "2030-10-02",
    })));
  });
  it("opens an unsent prefilled trip when the assistant prepared it", () => {
    const onCreate = vi.fn();
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[]} people={people} currentUser={people[0]!}
      onCreate={onCreate} onUpdate={vi.fn()} onAction={vi.fn()}
      assistantDraft={{ kind: "trip", ready: true, fields: {
        purpose: "Встреча в регионе", destination: "Навои",
        startDate: "2030-10-01", endDate: "2030-10-02",
      } }}
    /></FluentProvider>);
    expect(screen.queryByRole("textbox", { name: "Цель поездки" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Куда едем" })).toHaveValue("Навои");
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("shows only the destination field and uploads a selected brief on save", async () => {
    const saved = { ...request, id: "new-trip", stage: "launch" as const, status: "draft" as const,
      canEdit: true, allowedActions: ["submit"] as TripRequest["allowedActions"] };
    const onCreate = vi.fn(async () => saved);
    const onUploadBrief = vi.fn(async () => ({ ...saved, briefAttachmentName: "bildirgi.pdf" }));
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[]} people={people} currentUser={people[0]!}
      onCreate={onCreate} onUpdate={vi.fn()} onAction={vi.fn()}
      onUploadBrief={onUploadBrief} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    const brief = screen.getByLabelText("Загрузить билдирги");
    expect(screen.queryByRole("textbox", { name: "Цель поездки" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Источник покрытия расходов" })).not.toBeInTheDocument();
    expect(screen.queryByText("Общее")).not.toBeInTheDocument();
    expect(brief).toHaveAttribute("type", "file");
    fireEvent.change(screen.getByRole("combobox", { name: "Куда едем" }), { target: { value: "Термиз" } });
    const file = new File(["%PDF-1.4"], "bildirgi.pdf", { type: "application/pdf" });
    fireEvent.change(brief, { target: { files: [file] } });
    expect(screen.getByText("bildirgi.pdf")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onUploadBrief).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onUploadBrief).toHaveBeenCalledWith("new-trip", file));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "", expenseSource: "",
    }));
  });
  it("retries a failed brief upload without creating another trip", async () => {
    const saved = { ...request, id: "saved-trip", stage: "launch" as const, status: "draft" as const,
      canEdit: true, allowedActions: ["submit"] as TripRequest["allowedActions"] };
    const onCreate = vi.fn(async () => saved);
    const onUpdate = vi.fn(async () => saved);
    const onUploadBrief = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...saved, briefAttachmentName: "bildirgi.pdf" });
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[]} people={people} currentUser={people[0]!}
      onCreate={onCreate} onUpdate={onUpdate} onAction={vi.fn()}
      onUploadBrief={onUploadBrief} /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Куда едем" }), { target: { value: "Термиз" } });
    fireEvent.change(screen.getByLabelText("Загрузить билдирги"), { target: {
      files: [new File(["%PDF-1.4"], "bildirgi.pdf", { type: "application/pdf" })],
    } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Черновик сохранён, но билдирги не загрузилась");
    expect(screen.getByRole("combobox", { name: "Куда едем" })).toHaveValue("Термиз");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(onUploadBrief).toHaveBeenCalledTimes(2));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith(saved, expect.objectContaining({ purpose: "" }));
  });
  it("keeps selected employees while searching and previews the trip without sending it", async () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.change(screen.getByLabelText("Куда едем"), { target: { value: "Самарканд" } });
    fireEvent.change(screen.getByLabelText("Найти участника поездки"), { target: { value: "нет совпадений" } });
    expect(screen.getByText(/Сотрудники не найдены/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Сводка карточки")).getByText(people[0]!.name, { selector: "li" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Найти участника поездки"), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: new RegExp(people[0]!.name) })).toBeChecked();
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("keeps the full composer surface mounted while its exit animation finishes", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть форму создания" }));
    const exitingSurface = document.querySelector(".fui-DialogSurface");
    expect(exitingSurface === null || exitingSurface.classList.contains("record-composer-dialog")).toBe(true);
  });
  it("starts on the coloured board and filters the same cards in list view", async () => {
    setup();
    expect(screen.getByLabelText("Стадии поездок")).toBeInTheDocument();
    expect(column("manager_approval")).toHaveStyle({ "--approval-stage-color": "#849fd0" });
    expect(within(column("manager_approval") as HTMLElement).getByLabelText("1 поездок на этапе «Утверждение председателем»")).toHaveTextContent("1");
    fireEvent.change(screen.getByLabelText("Поиск поездок"), { target: { value: "нет совпадений" } });
    expect(document.querySelectorAll(".trip-board-card")).toHaveLength(0);
    expect(within(column("manager_approval") as HTMLElement).getByLabelText("0 поездок на этапе «Утверждение председателем»")).toHaveTextContent("0");
    fireEvent.change(screen.getByLabelText("Поиск поездок"), { target: { value: "самарканд" } });
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.getByLabelText("Список поездок").children).toHaveLength(1);
  });
  it("keeps a legacy HR-stage request accessible in the list without an HR lane", () => {
    setup({ ...request, stage: "hr", stageLabel: "Кадровая служба" });
    expect(column("hr")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.getByLabelText("Список поездок")).toHaveTextContent(request.destination);
  });
  it("routes a new signed trip directly to approved without showing the legacy HR column", async () => {
    const modern = { ...request, workflowVersion: 2, hasSignedBrief: true, hasEmployeeSignature: true };
    const { onAction } = setup(modern);
    expect(column("hr")).toBeNull();
    await drop("approved");
    await waitFor(() => expect(onAction).toHaveBeenCalledExactlyOnceWith(modern, "approve", undefined));
    expect(column("manager_approval").querySelector(".trip-board-card")).not.toBeNull();
  });
  it("opens the order preview inside the shared viewer", async () => {
    const modern = { ...request, workflowVersion: 3, hasSignedBrief: true };
    const onDownloadDocument = vi.fn(async () => new Blob(["pdf"], { type: "application/pdf" }));
    installSpatialGeometry();
    render(<FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[modern]} people={people} currentUser={people[0]!}
      onCreate={vi.fn()} onUpdate={vi.fn()} onAction={vi.fn()}
      onDownloadDocument={onDownloadDocument}
    /></FluentProvider>);
    fireEvent.click(card().querySelector(".approval-card-open")!);
    fireEvent.click(screen.getByRole("button", { name: "Предпросмотр приказа" }));
    expect(await screen.findByText("prikaz-preview.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Показать файл"));
    await waitFor(() => expect(onDownloadDocument).toHaveBeenCalledWith(modern.id, "order-preview", expect.any(AbortSignal)));
  });
  it("does not let a new trip be sent without a fresh signature confirmation", () => {
    const modern = { ...request, workflowVersion: 2, stage: "launch" as const,
      status: "draft" as const, allowedActions: ["submit"] as TripRequest["allowedActions"],
      canEdit: true, briefText: "Тестовая билдирги", expenseSource: "Проект",
      hasEmployeeSignature: false };
    setup(modern);
    fireEvent.click(card().querySelector(".approval-card-open")!);
    expect(screen.getByRole("button", { name: "Отправить председателю" })).toBeDisabled();
    expect(screen.getByText(/После исправления заявки подпись нужно подтвердить снова/)).toBeInTheDocument();
  });
  it("opens the attached brief in the viewer before confirming an existing signature", async () => {
    const modern = { ...request, workflowVersion: 2, stage: "launch" as const,
      status: "draft" as const, allowedActions: ["submit"] as TripRequest["allowedActions"],
      canEdit: true, briefAttachmentName: "bildirgi.jpg", briefAttachmentType: "image/jpeg",
      briefAttachmentSize: 1024, hasEmployeeSignature: false, originalSignatureConfirmed: false };
    const onSetOriginalSignature = vi.fn(async () => ({ ...modern, originalSignatureConfirmed: true }));
    const onDownloadDocument = vi.fn(async () => new Blob(["photo"], { type: "image/jpeg" }));
    const renderView = (item: TripRequest) => <FluentProvider theme={webLightTheme}><TripApprovalsView
      requests={[item]} people={people} currentUser={people[0]!} onCreate={vi.fn()}
      onUpdate={vi.fn()} onAction={vi.fn()} onSetOriginalSignature={onSetOriginalSignature}
      onDownloadDocument={onDownloadDocument} onUploadSignature={vi.fn()}
    /></FluentProvider>;
    installSpatialGeometry();
    const view = render(renderView(modern));
    fireEvent.click(card().querySelector(".approval-card-open")!);
    const confirmation = screen.getByRole("checkbox", { name: "Оригинал билдирги уже подписан мной" });
    expect(confirmation).toBeDisabled();
    expect(screen.getByRole("button", { name: "Отправить председателю" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Открыть оригинал/ }));
    fireEvent.click(await screen.findByText("Показать файл"));
    await waitFor(() => expect(confirmation).toBeEnabled());
    expect(onDownloadDocument).toHaveBeenCalledWith(modern.id, "attachment", expect.any(AbortSignal));
    fireEvent.click(confirmation);
    await waitFor(() => expect(onSetOriginalSignature).toHaveBeenCalledWith(modern.id, true));
    view.rerender(renderView({ ...modern, originalSignatureConfirmed: true }));
    expect(screen.getByRole("button", { name: "Отправить председателю" })).toBeEnabled();
    expect(screen.queryByTestId("signature-pad")).not.toBeInTheDocument();
  });
  it("blocks skipped stages and cards without permission", async () => {
    const { onAction } = setup({ ...request, stage: "launch", status: "draft", allowedActions: [] });
    expect(card()).not.toHaveAttribute("draggable", "true");
    expect(card().querySelector(".spatial-grip")).toBeNull();
    await drop("approved");
    expect(onAction).not.toHaveBeenCalled();
  });
  it("lets an administrator move a trip to any stage through the protected move action", async () => {
    const onAction = vi.fn(async () => ({ ...request, stage: "approved" as const }));
    setup({ ...request, allowedActions: [] }, onAction, people[3]!);
    await drop("approved");
    await waitFor(() => expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: request.id }),
      "move",
      expect.stringContaining("Утверждено"),
      "approved",
    ));
    expect(document.querySelector(".trip-feedback:not(.error)")).toBeNull();
  });
  it("requires a reason for a return, and cancelling leaves the card untouched", async () => {
    const onAction = vi.fn(async () => ({ ...request, stage: "launch" as const, stageLabel: "Запуск" }));
    setup(request, onAction);
    await drop("launch");
    expect(onAction).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Подтвердить решение" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-hidden", "true"));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    fireEvent.change(screen.getByLabelText("Причина решения"), { target: { value: "Уточнить даты" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledExactlyOnceWith(request, "return", "Уточнить даты"));
  });
  it("requires a reason for rejection too", async () => {
    const { onAction } = setup();
    await drop("rejected");
    expect(await screen.findByRole("form", { name: "Причина отклонения" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подтвердить решение" })).toBeDisabled();
    expect(onAction).not.toHaveBeenCalled();
  });
  it("does not send a second action while the first is pending", async () => {
    let finish!: (value: TripRequest | undefined) => void;
    const onAction = vi.fn(() => new Promise<TripRequest | undefined>((resolve) => { finish = resolve; }));
    setup({ ...request, workflowVersion: 2 }, onAction);
    await drop("approved");
    await drop("approved");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Согласовать: TR-TEST" })).toBeDisabled();
    finish(undefined);
    await screen.findByRole("alert");
  });
  it("validates missing fields and reversed dates without creating a trip", async () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Укажите место");
    fireEvent.change(screen.getByLabelText("Куда едем"), { target: { value: "Бухара" } });
    fireEvent.change(screen.getByLabelText("Дата начала"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("Дата окончания"), { target: { value: "2026-09-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Дата окончания не может быть раньше даты начала");
    expect(onCreate).not.toHaveBeenCalled();
  });
  it("opens the chat linked to a trip card", () => {
    const onOpenChat = vi.fn();
    setup(request, undefined, people[0]!, onOpenChat);
    fireEvent.click(screen.getByRole("button", { name: `Открыть чат поездки ${request.number}` }));
    expect(onOpenChat).toHaveBeenCalledWith("trip-chat");
  });
  it("keeps the trip detail and synchronized chat in one modal workspace", () => {
    setup(request, undefined, people[0]!, undefined, (trip) => <aside aria-label={`Чат поездки ${trip.number}`} />);
    fireEvent.click(card().querySelector(".approval-card-open")!);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("trip-dialog", "context-record-dialog");
    expect(within(dialog).getByLabelText(`Чат поездки ${request.number}`)).toBeInTheDocument();
    expect(dialog.querySelector(".trip-detail > header")).not.toBeNull();
  });
});
