import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIReferentIncomingAccess } from "./AIReferentIncomingAccess";
import { loadAIReferentIncomingAccess, saveAIReferentIncomingAccess } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", () => ({ loadAIReferentIncomingAccess: vi.fn(), saveAIReferentIncomingAccess: vi.fn() }));
const config = {
  rules: [
    { userId: "employee", mode: "default" as const, effectiveMode: "none" as const, revision: 0, responsibles: [] },
    { userId: "admin", mode: "default" as const, effectiveMode: "all" as const, revision: 0, responsibles: [] },
  ],
  responsibles: [{ agentId: "pc", externalId: "42", displayName: "Ответственный Exat" }],
};
function show() {
  return render(<FluentProvider theme={workspaceTheme}><AIReferentIncomingAccess token="qa" people={[
    { id: "employee", name: "Сотрудник", username: "employee", role: "employee", initials: "С", color: "teal" },
    { id: "admin", name: "Администратор", username: "admin", role: "admin", initials: "А", color: "teal" },
  ]} /></FluentProvider>);
}
async function select(name: string, option: RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
describe("incoming visibility settings", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadAIReferentIncomingAccess).mockResolvedValue(config); });
  afterEach(cleanup);

  it("saves the chosen robot responsibility with an optimistic revision", async () => {
    vi.mocked(saveAIReferentIncomingAccess).mockResolvedValue({ userId: "employee", mode: "assigned", effectiveMode: "assigned", revision: 1, responsibles: [{ agentId: "pc", externalId: "42" }] });
    show();
    await select("Сотрудник для видимости", /Сотрудник ·/);
    await select("Режим видимости входящих", /^Только назначенные Exat$/);
    expect(screen.getByRole("button", { name: "Сохранить видимость" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Ответственный Exat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить видимость" }));
    await waitFor(() => expect(saveAIReferentIncomingAccess).toHaveBeenCalledWith("qa", "employee", {
      mode: "assigned", expectedRevision: 0, responsibles: [{ agentId: "pc", externalId: "42" }],
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("Сохранено: Только назначенные Exat");
  });

  it("preserves selected bindings after a server conflict and offers refresh", async () => {
    vi.mocked(saveAIReferentIncomingAccess).mockRejectedValue(new Error("Видимость уже изменена"));
    show();
    await select("Сотрудник для видимости", /Сотрудник ·/);
    await select("Режим видимости входящих", /^Только назначенные Exat$/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Ответственный Exat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить видимость" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Видимость уже изменена");
    expect(screen.getByRole("checkbox", { name: /Ответственный Exat/ })).toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить настройки" })).toBeEnabled();
  });

  it("locks administrator visibility", async () => {
    show();
    await select("Сотрудник для видимости", /Администратор ·/);
    expect(screen.getByRole("combobox", { name: "Режим видимости входящих" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сохранить видимость" })).toBeDisabled();
    expect(saveAIReferentIncomingAccess).not.toHaveBeenCalled();
  });
});
