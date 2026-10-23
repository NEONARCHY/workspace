import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type * as Api from "./workspace-api";
import type * as Files from "./AIReferentFiles";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoRosterExports } from "./PhotoRosterExports";
import { DossiersWorkspace } from "./DossiersWorkspace";
import { downloadPersonnelPhotos, loadPersonnelPhotos } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", async original => ({ ...await original<typeof Api>(), downloadPersonnelPhotos: vi.fn(), loadPersonnelPhotos: vi.fn() }));
vi.mock("./AIReferentFiles", async original => ({ ...await original<typeof Files>(), saveReferentBlob: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(downloadPersonnelPhotos).mockResolvedValue(new Blob(["QA export"])); });
afterEach(cleanup);
function show(ids: readonly string[] = ["first", "second"], disabled = false) {
  return render(<FluentProvider theme={workspaceTheme}><PhotoRosterExports token="token" userIds={ids} disabled={disabled} /></FluentProvider>);
}

it.each([["Word", "word", "docx"], ["Excel", "excel", "xlsx"], ["PDF", "pdf", "pdf"]])("downloads %s using server-side fields and an explicit selection", async (label, kind, extension) => {
  show();
  fireEvent.click(screen.getByRole("button", { name: `Скачать фотокарточки в ${label}` }));
  await waitFor(() => expect(saveReferentBlob).toHaveBeenCalledWith(expect.any(Blob), `Фотокарточки сотрудников.${extension}`));
  expect(downloadPersonnelPhotos).toHaveBeenCalledWith("token", kind, { userIds: ["first", "second"] });
  expect(screen.getByRole("status")).toHaveTextContent("Сотрудников: 2.");
});

it("keeps selection and format options after an error and supports retry", async () => {
  vi.mocked(downloadPersonnelPhotos).mockRejectedValueOnce(new Error("Нет доступа к реестру"));
  show();
  fireEvent.click(screen.getByRole("button", { name: "Скачать фотокарточки в PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа к реестру");
  expect(saveReferentBlob).not.toHaveBeenCalled();
  const retry = await screen.findByRole("button", { name: "Скачать фотокарточки в Word" });
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  await waitFor(() => expect(saveReferentBlob).toHaveBeenCalledTimes(1));
  expect(downloadPersonnelPhotos).toHaveBeenLastCalledWith("token", "word", { userIds: ["first", "second"] });
});

it("prevents concurrent requests and never downloads optimistically", async () => {
  vi.mocked(downloadPersonnelPhotos).mockImplementation(() => new Promise(() => {}));
  show();
  const button = screen.getByRole("button", { name: "Скачать фотокарточки в Excel" });
  fireEvent.click(button); fireEvent.click(button);
  expect(downloadPersonnelPhotos).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в PDF" })).toBeDisabled();
  expect(saveReferentBlob).not.toHaveBeenCalled();
});

it.each([{ ids: [] }, { ids: Array.from({ length: 501 }, (_, i) => String(i)) }])("disables empty and oversized exports", ({ ids }) => {
  show(ids);
  expect(screen.getByRole("button", { name: "Скачать фотокарточки в Word" })).toBeDisabled();
  expect(downloadPersonnelPhotos).not.toHaveBeenCalled();
});

it("downloads all filtered rows rather than just the current page", async () => {
  const cards = Array.from({ length: 42 }, (_, i) => ({ userId: String(i), fullName: `Сотрудник ${i}`, jobTitle: i === 41 ? "Особая должность" : "Специалист", departmentId: null, birthYear: 1990, universities: [] }));
  vi.mocked(loadPersonnelPhotos).mockResolvedValue(cards);
  render(<FluentProvider theme={workspaceTheme}><DossiersWorkspace token="token" people={[]} mode="photos" context={{ canManageAccess: false, canViewPhotoRoster: true }} /></FluentProvider>);
  await screen.findByText("Сотрудников: 42");
  fireEvent.click(screen.getByRole("button", { name: "Скачать фотокарточки в Excel" }));
  await waitFor(() => expect(downloadPersonnelPhotos).toHaveBeenCalledWith("token", "excel", { userIds: cards.map(card => card.userId) }));
  await screen.findByText("Файл Excel подготовлен. Сотрудников: 42.");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Особая должность" } });
  fireEvent.click(screen.getByRole("button", { name: "Скачать фотокарточки в Word" }));
  await waitFor(() => expect(downloadPersonnelPhotos).toHaveBeenLastCalledWith("token", "word", { userIds: ["41"] }));
});

it("hides exports without photo-roster permission", async () => {
  vi.mocked(loadPersonnelPhotos).mockResolvedValue([]);
  render(<FluentProvider theme={workspaceTheme}><DossiersWorkspace token="token" people={[]} mode="photos" context={{ canManageAccess: false, canViewPhotoRoster: false }} /></FluentProvider>);
  await screen.findByText(/Сотрудники не найдены/);
  expect(screen.queryByRole("button", { name: /Скачать фотокарточки/ })).not.toBeInTheDocument();
});
