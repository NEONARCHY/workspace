import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { TripRequest, TripRequestInput } from "@yuksalish/contracts";
import { TripBriefEditor } from "./TripBriefEditor";

const brief = "2026-yil 22-oktabr kuni Qashqadaryo hududiga xizmat safari rejalashtirilgan. Safarning maqsadi: hamkor tashkilot vakillari bilan loyiha natijalarini muhokama qilish.\n\nShu munosabat bilan mazkur xizmat safariga ruxsat berishingizni soʻrayman. Safar xarajatlari loyiha mablagʻlari hisobidan qoplanadi.";
const request: TripRequest = {
  id: "trip-1", number: "TR-1", requesterUserId: "user-1", workflowVersion: 3,
  purpose: "Hamkor tashkilot vakillari bilan loyiha natijalarini muhokama qilish",
  destination: "Qashqadaryo", startDate: "2026-10-22", endDate: "2026-10-22",
  employeeIds: ["user-1"], briefText: brief, briefFormat: "generated", expenseSource: "loyiha mablagʻlari",
  briefFontSize: 11, briefFontWeight: "regular", stage: "launch", stageLabel: "Запуск",
  status: "draft", statusLabel: "Черновик", canEdit: true, allowedActions: ["submit"],
  actions: [], createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
};
const show = (onSave: (request: TripRequest, payload: TripRequestInput) => Promise<TripRequest | undefined>
  = vi.fn(async () => ({ ...request, briefFormat: "edited" as const }))) => {
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<FluentProvider theme={webLightTheme}><TripBriefEditor request={request} onClose={onClose} onSave={onSave} onSaved={onSaved} /></FluentProvider>);
  return { onSave, onClose, onSaved };
};
afterEach(cleanup);

it("compares the original with edits and saves bounded typography with the complete trip payload", async () => {
  const { onSave, onSaved } = show();
  expect(screen.getByRole("button", { name: "Сохранить и проверить PDF" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Сравнить с исходным текстом" }));
  expect(screen.getByText("До изменений")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Текст билдирги в редакторе" }), { target: { value: `${brief}\n\nQoʻshimcha uchrashuv ham oʻtkaziladi.` } });
  fireEvent.change(screen.getByRole("combobox", { name: "Размер текста билдирги" }), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "Полужирный" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и проверить PDF" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith(request, expect.objectContaining({
    briefFormat: "edited", briefFontSize: 12, briefFontWeight: "bold", destination: "Qashqadaryo",
    briefText: expect.stringContaining("Qoʻshimcha uchrashuv"),
  }));
});

it("keeps the draft after a save failure and asks before discarding changes", async () => {
  const onSave = vi.fn(async () => undefined);
  const { onClose } = show(onSave);
  fireEvent.change(screen.getByRole("textbox", { name: "Текст билдирги в редакторе" }), { target: { value: `${brief} Qoʻshimcha uchrashuv.` } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и проверить PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить");
  expect(screen.getByRole("textbox", { name: "Текст билдирги в редакторе" })).toHaveValue(`${brief} Qoʻshimcha uchrashuv.`);
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть без сохранения" }));
  expect(onClose).toHaveBeenCalledOnce();
});
