import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIReferentAddressBook } from "./AIReferentAddressBook";
import { workspaceTheme } from "./workspace-theme";
import {
  addAIReferentManualRecipient,
  loadAIReferentManualRecipients,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  addAIReferentManualRecipient: vi.fn(),
  loadAIReferentManualRecipients: vi.fn(),
  removeAIReferentManualRecipient: vi.fn(),
}));

const renderBook = (readOnly = false) => render(
  <FluentProvider theme={workspaceTheme}><AIReferentAddressBook token="test" readOnly={readOnly} /></FluentProvider>,
);

describe("AI Referent administrator address book", () => {
  beforeEach(() => {
    vi.mocked(loadAIReferentManualRecipients).mockResolvedValue([]);
    vi.mocked(addAIReferentManualRecipient).mockReset();
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("saves an address and shows the shared entry", async () => {
    vi.mocked(addAIReferentManualRecipient).mockResolvedValue({
      id: "manual-123", name: "Новая организация", addresses: ["office@exat.uz"],
      route: "exat", categoryKey: "other", addressBookOrganization: "Новая организация",
    });
    renderBook();
    await screen.findByText("Пока нет добавленных адресов. Справочник робота продолжает работать как прежде.");
    fireEvent.change(screen.getByLabelText("Название организации"), { target: { value: "Новая организация" } });
    fireEvent.change(screen.getByLabelText("E-XAT-адрес или email"), { target: { value: "office@exat.uz" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(addAIReferentManualRecipient).toHaveBeenCalledWith("test", {
      name: "Новая организация", address: "office@exat.uz", categoryKey: "other",
    }));
    expect(await screen.findByText("office@exat.uz · E-XAT")).toBeTruthy();
  });

  it("preserves the input after an error and disables writes in read-only mode", async () => {
    vi.mocked(addAIReferentManualRecipient).mockRejectedValue(new Error("Адрес уже добавлен"));
    const view = renderBook();
    await screen.findByText("Пока нет добавленных адресов. Справочник робота продолжает работать как прежде.");
    fireEvent.change(screen.getByLabelText("Название организации"), { target: { value: "Другая организация" } });
    fireEvent.change(screen.getByLabelText("E-XAT-адрес или email"), { target: { value: "office@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Адрес уже добавлен");
    expect(screen.getByLabelText("Название организации")).toHaveProperty("value", "Другая организация");
    view.unmount();
    renderBook(true);
    expect(screen.getByLabelText("Название организации")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Сохранить" })).toHaveProperty("disabled", true);
  });
});
