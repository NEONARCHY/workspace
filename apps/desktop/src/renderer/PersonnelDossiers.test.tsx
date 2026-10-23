import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { DossierDetail, WorkspacePerson } from "@yuksalish/contracts";
import type * as Api from "./workspace-api";
import type * as ReferentFiles from "./AIReferentFiles";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DossierDialog } from "./DossierDialog";
import { DossierImportSection } from "./DossierImportSection";
import { DossierProfileEntry } from "./DossierProfileEntry";
import { DossiersWorkspace } from "./DossiersWorkspace";
import { DossierAccessDialog } from "./DossierAccessDialog";
import { workspaceTheme } from "./workspace-theme";
import { downloadDossierPdf, downloadDossierWord, loadDossier, loadDossierAccess, loadDossierHistory, loadDossierList, loadDossierPermissions, loadPersonnelPhotos, previewDossierImport, saveDossier, saveDossierAccess } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";

vi.mock("./AIReferentFiles", async (original) => ({ ...await original<typeof ReferentFiles>(), saveReferentBlob: vi.fn() }));

vi.mock("./workspace-api", async (original) => ({ ...await original<typeof Api>(),
  loadDossier: vi.fn(), loadDossierHistory: vi.fn(), saveDossier: vi.fn(),
  loadDossierPermissions: vi.fn(), loadDossierList: vi.fn(), loadPersonnelPhotos: vi.fn(),
  loadDossierAccess: vi.fn(), saveDossierAccess: vi.fn(), downloadDossierWord: vi.fn(), downloadDossierPdf: vi.fn(), previewDossierImport: vi.fn(),
}));
const person: WorkspacePerson = { id: "employee", name: "Тестовый Сотрудник Полное ФИО", initials: "ТС", role: "employee", color: "brand", status: "active" };
const record: DossierDetail = { userId: person.id, fullName: person.name, jobTitle: "Специалист", revision: 1, status: "draft", updatedAt: null, permissions: { canView: true, canEdit: true }, fields: { birthDate: null, birthPlace: "", appointmentDate: null, nationality: "", partyMembership: "", educationLevel: "", academicTitle: "", militaryRank: "", electedMembership: "", relatives: [], education: [], employment: [], languages: "", academicDegree: "", awards: "", additionalInfo: "" } };
const close = vi.fn();
function show(node: React.ReactNode) { return render(<FluentProvider theme={workspaceTheme}>{node}</FluentProvider>); }
beforeEach(() => {
  vi.mocked(loadDossier).mockResolvedValue(record);
  vi.mocked(loadDossierHistory).mockResolvedValue([]);
  vi.mocked(loadDossierPermissions).mockResolvedValue({ canView: false, canEdit: false });
  vi.mocked(loadDossierList).mockResolvedValue([{ userId: person.id, fullName: person.name, jobTitle: "Специалист", departmentId: null, status: "draft", updatedAt: null }]);
  vi.mocked(loadPersonnelPhotos).mockResolvedValue([{ userId: person.id, fullName: person.name, jobTitle: "Специалист", departmentId: null, birthYear: 1991, universities: ["Тестовый университет"] }]);
  vi.mocked(loadDossierAccess).mockResolvedValue({ revision: 1, rules: [{ granteeUserId: person.id, scope: "all", scopeId: null, view: true, edit: false, photoRoster: false }] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("keeps fields after a failed save and retries with the original revision", async () => {
  vi.mocked(saveDossier).mockRejectedValueOnce(new Error("Временная ошибка")).mockResolvedValueOnce({ ...record, revision: 2, status: "saved", fields: { ...record.fields, birthPlace: "Ташкент" } });
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  const input = await screen.findByRole("textbox", { name: "Место рождения" });
  fireEvent.change(input, { target: { value: "Ташкент" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить объективку" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Временная ошибка");
  expect(input).toHaveValue("Ташкент");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить объективку" }));
  await screen.findByText("Объективка сохранена. Версия 2.");
  expect(saveDossier).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveDossier).mock.calls[1]?.[2]).toMatchObject({ revision: 1, status: "saved", fields: { birthPlace: "Ташкент" } });
});

it("adds education and employment locally, protects dirty input on closing", async () => {
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Добавить образование" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Учебное заведение" }), { target: { value: "Университет" } });
  fireEvent.click(screen.getByRole("button", { name: "Добавить место работы" }));
  expect(screen.getByRole("textbox", { name: "Организация" })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.getByRole("alert")).toHaveTextContent("несохранённые изменения");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Продолжить редактирование" }));
  expect(screen.getByRole("textbox", { name: "Учебное заведение" })).toHaveValue("Университет");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  expect(screen.getByRole("alert")).toHaveTextContent("организацию или должность и начало");
  expect(saveDossier).not.toHaveBeenCalled();
});

it("does not offer editing for a view-only questionnaire", async () => {
  vi.mocked(loadDossier).mockResolvedValue({ ...record, permissions: { canView: true, canEdit: false } });
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  expect(await screen.findByRole("textbox", { name: "Место рождения" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Сохранить объективку" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Выбрать объективку Word")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скачать PDF" })).toBeEnabled();
});

it("only shows the profile entry after the server grants private view permission", async () => {
  show(<DossierProfileEntry token="token" userId={person.id} people={[]} />);
  await waitFor(() => expect(loadDossierPermissions).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Объективка" })).not.toBeInTheDocument();
  cleanup();
  vi.mocked(loadDossierPermissions).mockResolvedValue({ canView: true, canEdit: true });
  show(<DossierProfileEntry token="token" userId={person.id} people={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Объективка" }));
  expect(await screen.findByRole("dialog", { name: "Объективка сотрудника" })).toBeInTheDocument();
});

it("shows a separate minimal photo roster with exports and filters it", async () => {
  show(<DossiersWorkspace token="token" people={[]} mode="photos" context={{ canManageAccess: false, canViewPhotoRoster: true }} />);
  expect(await screen.findByText("Тестовый университет")).toBeInTheDocument();
  expect(screen.getByText("1991")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Настроить доступ" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в Word" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в Excel" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в PDF" })).toBeEnabled();
  expect(within(screen.getByRole("region", { name: "Реестр фотокарточек" })).queryByRole("button")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Другой сотрудник" } });
  expect(screen.getByText(/Сотрудники не найдены/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в Word" })).toBeDisabled();
});

it("retains the access change and reason after a server rejection", async () => {
  vi.mocked(saveDossierAccess).mockRejectedValue(new Error("Права уже изменились"));
  show(<DossierAccessDialog token="token" people={[person]} departments={[]} onClose={close} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Убрать правило 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Основание изменения доступа" }), { target: { value: "Отзыв доступа" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить права" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Права уже изменились");
  expect(screen.getByRole("textbox", { name: "Основание изменения доступа" })).toHaveValue("Отзыв доступа");
  expect(screen.getByText("Дополнительный доступ не выдан.")).toBeInTheDocument();
  expect(saveDossierAccess).toHaveBeenCalledWith("token", { revision: 1, rules: [], reason: "Отзыв доступа" });
  expect(close).not.toHaveBeenCalled();
});

it("opens only accessible questionnaires from the HR list", async () => {
  show(<DossiersWorkspace token="token" people={[]} mode="dossiers" context={{ canManageAccess: false, canViewPhotoRoster: false }} />);
  fireEvent.click(await screen.findByRole("button", { name: `Объективка: ${person.name}` }));
  const dialog = await screen.findByRole("dialog", { name: "Объективка сотрудника" });
  expect(await within(dialog).findByText(person.name)).toBeInTheDocument();
});

it("downloads the saved revision only, retains input on download failure and retries", async () => {
  const blob = new Blob(["test Word"]);
  vi.mocked(downloadDossierWord).mockRejectedValueOnce(new Error("Сервис временно недоступен")).mockResolvedValueOnce(blob);
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Скачать Word" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Сервис временно недоступен");
  expect(saveReferentBlob).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Скачать Word" }));
  await waitFor(() => expect(saveReferentBlob).toHaveBeenCalledWith(blob, `Объективка ${person.name}.docx`));
  expect(downloadDossierWord).toHaveBeenLastCalledWith("token", person.id, 1);
  fireEvent.change(screen.getByRole("textbox", { name: "Место рождения" }), { target: { value: "Новый ввод" } });
  expect(screen.getByRole("button", { name: "Скачать Word" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Место рождения" })).toHaveValue("Новый ввод");
});

it("adds relatives locally and prevents saving an unidentified relative", async () => {
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Добавить родственника" }));
  fireEvent.change(screen.getByRole("textbox", { name: "ФИО родственника" }), { target: { value: "Тестовый родственник" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  expect(screen.getByRole("alert")).toHaveTextContent("степень родства");
  expect(saveDossier).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "ФИО родственника" })).toHaveValue("Тестовый родственник");
});

const importResult = {
  sourceFullName: "Тестовое ФИО из документа", sourceJobTitle: "Должность из файла",
  fields: { ...record.fields, birthPlace: "Город из Word", languages: "Язык из Word" },
  detectedFields: ["birthPlace", "languages"] as const,
  warnings: ["Тестовое предупреждение: проверьте документ"], unrecognizedText: "Нераспознанный текст",
};

it("accepts a dropped Word file and blocks a second import while parsing", async () => {
  vi.mocked(previewDossierImport).mockImplementationOnce(() => new Promise(() => {}));
  show(<DossierImportSection token="token" userId={person.id} fullName={person.name} disabled={false} onApply={vi.fn()} />);
  const picker = screen.getByLabelText("Выбрать объективку Word");
  const zone = picker.closest("label");
  expect(zone).not.toBeNull();
  const file = new File(["test"], "Моя объективка.docx");
  fireEvent.drop(zone!, { dataTransfer: { files: [file] } });
  expect(previewDossierImport).toHaveBeenCalledWith("token", person.id, file);
  expect(screen.getByRole("status")).toHaveTextContent("Моя объективка.docx");
  expect(picker).toBeDisabled();
  fireEvent.drop(zone!, { dataTransfer: { files: [file] } });
  expect(previewDossierImport).toHaveBeenCalledTimes(1);
});

it("does not import dropped files when editing is disabled", () => {
  show(<DossierImportSection token="token" userId={person.id} fullName={person.name} disabled onApply={vi.fn()} />);
  const picker = screen.getByLabelText("Выбрать объективку Word");
  expect(picker).toBeDisabled();
  fireEvent.drop(picker.closest("label")!, { dataTransfer: { files: [new File(["test"], "objective.docx")] } });
  expect(previewDossierImport).not.toHaveBeenCalled();
});

it("stages a Word import, requires identity confirmation and only applies selected sections locally", async () => {
  vi.mocked(previewDossierImport).mockResolvedValue(importResult);
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  const birth = await screen.findByRole("textbox", { name: "Место рождения" });
  fireEvent.change(birth, { target: { value: "Мой несохранённый ввод" } });
  const file = new File(["test DOCX"], "objective.docx");
  fireEvent.change(screen.getByLabelText("Выбрать объективку Word"), { target: { files: [file] } });
  await screen.findByText("Тестовое ФИО из документа");
  expect(previewDossierImport).toHaveBeenCalledWith("token", person.id, file);
  expect(birth).toHaveValue("Мой несохранённый ввод");
  expect(saveDossier).not.toHaveBeenCalled();
  const apply = screen.getByRole("button", { name: "Перенести выбранные поля в форму" });
  expect(apply).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Перенести: Место рождения" }));
  fireEvent.click(screen.getByRole("checkbox", { name: `Я проверил документ: сведения относятся к сотруднику ${person.name}` }));
  fireEvent.click(apply);
  expect(birth).toHaveValue("Мой несохранённый ввод");
  expect(screen.getByRole("textbox", { name: "Владение языками" })).toHaveValue("Язык из Word");
  expect(saveDossier).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Скачать PDF" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Скачать Word" })).toBeDisabled();
});

it("retains manual input after failed Word parsing and supports selecting the same file again", async () => {
  vi.mocked(previewDossierImport).mockRejectedValueOnce(new Error("DOCX повреждён")).mockResolvedValueOnce(importResult);
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  const birth = await screen.findByRole("textbox", { name: "Место рождения" });
  fireEvent.change(birth, { target: { value: "Мой ввод" } });
  const file = new File(["test"], "objective.docx");
  const input = screen.getByLabelText("Выбрать объективку Word");
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("DOCX повреждён");
  expect(birth).toHaveValue("Мой ввод");
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText("Тестовое ФИО из документа");
  fireEvent.click(screen.getByRole("button", { name: "Отменить импорт" }));
  expect(input).toHaveFocus();
  expect(birth).toHaveValue("Мой ввод");
  expect(saveDossier).not.toHaveBeenCalled();
});

it("downloads PDF with the saved revision, handles converter failure and keeps Word available", async () => {
  const blob = new Blob(["%PDF-test"], { type: "application/pdf" });
  vi.mocked(downloadDossierPdf).mockRejectedValueOnce(new Error("Конвертер занят")).mockResolvedValueOnce(blob);
  show(<DossierDialog token="token" userId={person.id} people={[]} onClose={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Скачать PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Конвертер занят");
  expect(screen.getByRole("button", { name: "Скачать Word" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Скачать PDF" }));
  await waitFor(() => expect(saveReferentBlob).toHaveBeenCalledWith(blob, `Объективка ${person.name}.pdf`));
  expect(downloadDossierPdf).toHaveBeenLastCalledWith("token", person.id, 1);
});
