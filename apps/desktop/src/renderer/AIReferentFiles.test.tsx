import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AIReferentPacketFile, AIReferentPacketKind } from "@yuksalish/contracts";
import { AIReferentFiles } from "./AIReferentFiles";
import { workspaceTheme } from "./workspace-theme";
import { downloadAIReferentPacket, loadAIReferentPacket, previewAIReferentPacketFile } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadAIReferentPacket: vi.fn(), downloadAIReferentPacket: vi.fn(), previewAIReferentPacketFile: vi.fn() }));
vi.mock("./PdfFilePreview", () => ({ default: ({ blob }: { blob: Blob }) => <div data-testid="packet-pdf">PDF {blob.type}</div> }));

const file: AIReferentPacketFile = { id: "file-1", name: "published/Письмо.docx", source: "packet", byteSize: 2000, sha256: "a".repeat(64), createdAt: "2026-10-22T10:00:00Z" };
beforeEach(() => {
  vi.mocked(loadAIReferentPacket).mockResolvedValue({ files: [file] });
  vi.mocked(previewAIReferentPacketFile).mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  vi.mocked(downloadAIReferentPacket).mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:packet");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function openPacket(kind: AIReferentPacketKind = "outgoing") {
  render(<FluentProvider theme={workspaceTheme}><AIReferentFiles token="session" kind={kind} ownerId="letter" /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Пакет документов" }));
  return screen.findByRole("button", { name: "Открыть в Workspace: Письмо.docx" });
}

it.each<AIReferentPacketKind>(["outgoing", "incoming", "archive", "journal"])("previews %s Word through its own protected packet route", async kind => {
  const opener = await openPacket(kind);
  opener.focus();
  fireEvent.click(opener);
  expect(await screen.findByTestId("packet-pdf")).toHaveTextContent("application/pdf");
  expect(previewAIReferentPacketFile).toHaveBeenCalledWith("session", kind, "letter", file, 0, 0, expect.any(AbortSignal));
  expect(downloadAIReferentPacket).not.toHaveBeenCalled();
  // jsdom does not run the browser's native dialog focus transfer.
  (await screen.findByRole("button", { name: "Закрыть просмотрщик", hidden: true })).focus();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть просмотрщик" }));
  await waitFor(() => expect(screen.queryByTestId("packet-pdf")).not.toBeInTheDocument());
  // Actual return-focus/keyboard behavior is verified in browser QA, not the
  // layout-less jsdom modalizer. Here the packet and original opener must survive.
  expect(screen.getByRole("button", { name: opener.getAttribute("aria-label")! })).toBe(opener);
});

it("opens a signed PDF directly, preserving separate download actions", async () => {
  const pdf = { ...file, name: "signed.pdf" };
  vi.mocked(loadAIReferentPacket).mockResolvedValue({ files: [pdf] });
  render(<FluentProvider theme={workspaceTheme}><AIReferentFiles token="session" kind="outgoing" ownerId="letter" /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Пакет документов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Открыть в Workspace: signed.pdf" }));
  await screen.findByTestId("packet-pdf");
  expect(downloadAIReferentPacket).toHaveBeenCalledWith("session", "outgoing", "letter", pdf, expect.any(AbortSignal));
  expect(previewAIReferentPacketFile).not.toHaveBeenCalled();
  (await screen.findByRole("button", { name: "Закрыть просмотрщик", hidden: true })).focus();
  const viewer = screen.getByRole("dialog", { name: "signed.pdf" });
  fireEvent.click(within(viewer).getByRole("button", { name: "Скачать" }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
});

it("retries failed conversion without losing the packet or downloading silently", async () => {
  vi.mocked(previewAIReferentPacketFile).mockRejectedValueOnce(new Error("Конвертер временно недоступен"));
  fireEvent.click(await openPacket());
  expect(await screen.findByRole("alert")).toHaveTextContent("Конвертер временно недоступен");
  expect(screen.getByText("Просмотр недоступен · оригинал можно скачать")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  await screen.findByTestId("packet-pdf");
  expect(previewAIReferentPacketFile).toHaveBeenCalledTimes(2);
  expect(downloadAIReferentPacket).not.toHaveBeenCalled();
});

it("keeps unsupported files downloadable without a nonworking preview button", async () => {
  vi.mocked(loadAIReferentPacket).mockResolvedValue({ files: [{ ...file, name: "archive.zip" }] });
  render(<FluentProvider theme={workspaceTheme}><AIReferentFiles token="session" kind="incoming" ownerId="letter" /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Пакет документов" }));
  fireEvent.click(await screen.findByRole("button", { name: "Скачать archive.zip" }));
  await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /Открыть в Workspace/ })).not.toBeInTheDocument();
});
