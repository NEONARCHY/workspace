import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HrIdentityImport, mergeIdentityResults } from "./HrIdentityImport";
import { recognizeHiringIdentity } from "./workspace-api";

vi.mock("./workspace-api", () => ({ recognizeHiringIdentity: vi.fn() }));
const result = { fullName: "TESTOV ALI TESTOVICH", pinfl: "00000000000000", passport: "AD0000000", warnings: [] };
beforeEach(() => {
  vi.mocked(recognizeHiringIdentity).mockResolvedValue(result);
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:synthetic"); static override revokeObjectURL = vi.fn(); });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
function mount(current = { fullName: "", pinfl: "", passport: "" }) {
  const apply = vi.fn();
  render(<FluentProvider theme={webLightTheme}><HrIdentityImport token="synthetic" current={current} disabled={false} onApply={apply} /></FluentProvider>);
  return apply;
}
function choose() { fireEvent.change(screen.getByLabelText("Фото ID-карты"), { target: { files: [new File(["synthetic"], "id.png", { type: "image/png" })] } }); }

it("uploads only explicitly and applies reviewed selected fields without replacing others", async () => {
  const apply = mount({ fullName: "Уже введённое имя", pinfl: "", passport: "" });
  choose(); expect(recognizeHiringIdentity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Распознать данные" }));
  const name = await screen.findByLabelText("ФИО с ID-карты");
  expect(name).toHaveValue(result.fullName);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Применить: JSHSHIR с ID-карты" }));
  const confirm = screen.getByRole("button", { name: "Применить выбранные поля" });
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Данные проверены по оригиналу ID-карты" }));
  fireEvent.click(confirm);
  expect(apply).toHaveBeenCalledWith({ pinfl: result.pinfl });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});

it("retains images after an OCR error and retries without applying data", async () => {
  vi.mocked(recognizeHiringIdentity).mockRejectedValueOnce(new Error("OCR недоступен"));
  const apply = mount(); choose();
  fireEvent.click(screen.getByRole("button", { name: "Распознать данные" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("OCR недоступен");
  expect(screen.getByAltText("Фото ID-карты, сторона 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Распознать данные" }));
  await screen.findByLabelText("JSHSHIR с ID-карты");
  await waitFor(() => expect(recognizeHiringIdentity).toHaveBeenCalledTimes(2));
  expect(apply).not.toHaveBeenCalled();
});

it("never guesses between contradictory sides", () => {
  const merged = mergeIdentityResults([result, { ...result, pinfl: "11111111111111", fullName: null }]);
  expect(merged.pinfl).toBeNull();
  expect(merged.fullName).toBe(result.fullName);
  expect(merged.warnings.join(" ")).toContain("разные значения");
});
