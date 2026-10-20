import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { ReferenceDirectory } from "@yuksalish/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReferenceView } from "./ReferenceView";
import { workspaceTheme } from "./workspace-theme";

const api = vi.hoisted(() => ({
  load: vi.fn(), saveProfile: vi.fn(), createPartner: vi.fn(), savePartner: vi.fn(),
  createExpert: vi.fn(), saveExpert: vi.fn(), createTemplate: vi.fn(), saveTemplate: vi.fn(),
  uploadTemplate: vi.fn(), downloadTemplate: vi.fn(), previewTemplate: vi.fn(),
}));
vi.mock("./workspace-api", () => ({
  loadReferenceDirectory: api.load,
  saveReferenceProfile: api.saveProfile,
  createReferencePartner: api.createPartner,
  saveReferencePartner: api.savePartner,
  createReferenceExpert: api.createExpert,
  saveReferenceExpert: api.saveExpert,
  createReferenceTemplate: api.createTemplate,
  saveReferenceTemplate: api.saveTemplate,
  uploadReferenceTemplate: api.uploadTemplate,
  downloadReferenceTemplate: api.downloadTemplate,
  previewReferenceTemplate: api.previewTemplate,
}));
vi.mock("./FileViewer", () => ({ ExternalFileViewer: () => <div>Предпросмотр файла</div> }));

const directory: ReferenceDirectory = {
  profile: {
    legalName: "", shortName: "", tin: "", registeredAddress: "", postalAddress: "",
    bankName: "", bankCode: "", bankAccount: "", phone: "", email: "", website: "",
    revision: 0, updatedAt: null,
  },
  partners: [], experts: [],
  templates: [{
    id: "draft", title: "Грантовая заявка", kind: "grant", locale: "ru",
    description: "", archived: false, revision: 1, updatedAt: "2026-10-19T10:00:00Z",
    versions: [],
  }],
  changes: [],
};

function show(canEdit = false) {
  return render(<FluentProvider theme={workspaceTheme}>
    <ReferenceView token="token" canCreate={canEdit} canEdit={canEdit} people={[]} />
  </FluentProvider>);
}

beforeEach(() => { vi.clearAllMocks(); api.load.mockResolvedValue(directory); });
afterEach(cleanup);

it("shows verified profile fields without inventing official requisites", async () => {
  show();
  expect(await screen.findByText("Официальное название")).toBeInTheDocument();
  expect(screen.getAllByText("Не заполнено").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
});

it("hides a template draft without a file from read-only employees", async () => {
  show();
  await screen.findByText("Официальное название");
  fireEvent.click(screen.getByRole("button", { name: "Шаблоны" }));
  expect(screen.queryByText("Грантовая заявка")).not.toBeInTheDocument();
  expect(screen.getByText("Шаблонов по этому запросу нет.")).toBeInTheDocument();
});

it("keeps unsaved requisites after a server conflict", async () => {
  api.saveProfile.mockRejectedValue(new Error("Реквизиты изменились"));
  show(true);
  await screen.findByText("Официальное название");
  fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
  fireEvent.change(screen.getByRole("textbox", { name: "ИНН" }), { target: { value: "123456789" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith("token", expect.objectContaining({ tin: "123456789" }), 0));
  expect(await screen.findByText("Реквизиты изменились")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "ИНН" })).toHaveValue("123456789");
});

it("creates a partner only after the form is explicitly saved", async () => {
  api.createPartner.mockResolvedValue({ id: "partner-1" });
  show(true);
  await screen.findByText("Официальное название");
  fireEvent.click(screen.getByRole("button", { name: "Организации" }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название *" }), { target: { value: "Новый партнёр" } });
  expect(api.createPartner).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(api.createPartner).toHaveBeenCalledWith(
    "token", expect.objectContaining({ name: "Новый партнёр", kind: "partner" }),
  ));
});
