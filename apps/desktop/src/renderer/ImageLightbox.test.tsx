import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImageLightbox from "./ImageLightbox";
import { workspaceTheme } from "./workspace-theme";
const photo = (id: string) => ({ id, fileName: `${id}.png`, contentType: "image/png", byteSize: 100 });
const first = photo("first"), second = photo("second"), third = photo("third");
function setup() {
  const props = { attachment: second, images: [first, second, third].map((attachment) => ({ attachment, caption: `Описание ${attachment.id}`, author: "Автор", messageId: attachment.id, chatId: "chat" })), onLoad: vi.fn().mockResolvedValue(new Blob(["image"])), onDownload: vi.fn(), onClose: vi.fn(), onGoToMessage: vi.fn(), onForward: vi.fn() };
  const view = render(<FluentProvider theme={workspaceTheme}><ImageLightbox {...props} /></FluentProvider>);
  return { ...props, view };
}
beforeEach(() => { vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:image"); vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("ImageLightbox", () => {
  it("never flashes the loading indicator for fast or cached images", async () => {
    vi.useFakeTimers();
    setup();
    expect(screen.queryByText("Открываем изображение…")).not.toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("img", { name: "second.png" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("Открываем изображение…")).not.toBeInTheDocument();
  });
  it("delays slow-load feedback and restarts the delay when navigating", async () => {
    vi.useFakeTimers();
    const load = vi.fn(() => new Promise<Blob>(() => {}));
    render(<FluentProvider theme={workspaceTheme}><ImageLightbox attachment={first} images={[first, second].map((attachment) => ({ attachment }))} onLoad={load} onDownload={vi.fn()} onClose={vi.fn()} /></FluentProvider>);
    act(() => vi.advanceTimersByTime(399));
    expect(screen.queryByText("Открываем изображение…")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("Открываем изображение…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));
    expect(screen.queryByText("Открываем изображение…")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("Открываем изображение…")).toBeInTheDocument();
  });
  it("opens selected photo, displays its caption and navigates to adjacent messages", async () => {
    const p = setup(); await screen.findByRole("img", { name: "second.png" });
    expect(screen.getByText("Описание second")).toBeInTheDocument();
    expect(screen.getByText("Фото 2 из 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Предыдущее фото" }));
    await screen.findByRole("img", { name: "first.png" });
    expect(screen.getByRole("button", { name: "Предыдущее фото" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Следующее фото" }));
    await screen.findByRole("img", { name: "second.png" });
    expect(p.onLoad).toHaveBeenLastCalledWith(second, expect.any(AbortSignal));
  });
  it("zooms with Ctrl-wheel without changing photo; normal wheel navigates and resets zoom", async () => {
    setup(); await screen.findByRole("img", { name: "second.png" });
    const stage = screen.getByLabelText(/Ctrl и колесо/);
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    fireEvent.wheel(stage, { ctrlKey: true, deltaY: -100 });
    expect(screen.getByRole("button", { name: "Сбросить масштаб" })).not.toHaveTextContent("100%");
    expect(screen.getByText("Фото 2 из 3")).toBeInTheDocument();
    fireEvent.wheel(stage, { deltaY: -100 });
    await screen.findByRole("img", { name: "first.png" });
    expect(screen.getByRole("button", { name: "Сбросить масштаб" })).toHaveTextContent("100%");
  });
  it("offers real context actions, Escape only closes menu, and downloads current photo", async () => {
    const p = setup(); await screen.findByRole("img", { name: "second.png" });
    fireEvent.contextMenu(screen.getByLabelText(/Ctrl и колесо/), { clientX: 40, clientY: 50 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Сохранить как…" }));
    expect(p.onDownload).toHaveBeenCalledWith(second);
    fireEvent.contextMenu(screen.getByLabelText(/Ctrl и колесо/));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Повернуть" }), { key: "Escape" });
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByLabelText(/Ctrl и колесо/));
    fireEvent.click(screen.getByRole("menuitem", { name: "Перейти к сообщению" }));
    expect(p.onGoToMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: "second" }));
  });
  it("provides a selectable gallery without wrapping at either end", async () => {
    setup(); await screen.findByRole("img", { name: "second.png" });
    fireEvent.click(screen.getByRole("button", { name: "Все фотографии" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть фото: third.png" }));
    await screen.findByRole("img", { name: "third.png" });
    expect(screen.getByRole("button", { name: "Следующее фото" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText(/Ctrl и колесо/), { key: "ArrowLeft" });
    await screen.findByRole("img", { name: "second.png" });
  });
  it("aborts and revokes resources, ignoring late image loads", async () => {
    const p = setup(); await screen.findByRole("img", { name: "second.png" });
    const signal = p.onLoad.mock.calls[0]![1] as AbortSignal;
    p.view.unmount(); expect(signal.aborted).toBe(true); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image");
    let resolve: ((blob: Blob) => void) | undefined;
    const load = vi.fn(() => new Promise<Blob>((done) => { resolve = done; }));
    const view = render(<FluentProvider theme={workspaceTheme}><ImageLightbox attachment={first} onLoad={load} onDownload={vi.fn()} onClose={vi.fn()} /></FluentProvider>);
    view.unmount(); vi.mocked(URL.createObjectURL).mockClear();
    await act(async () => resolve?.(new Blob(["late"])));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it("shows load errors and permits retry", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Нет доступа")).mockResolvedValue(new Blob(["image"]));
    render(<FluentProvider theme={workspaceTheme}><ImageLightbox attachment={first} onLoad={load} onDownload={vi.fn()} onClose={vi.fn()} /></FluentProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Нет доступа");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "first.png" })).toBeInTheDocument());
  });
  it("uses the existing forwarding action for the current message", async () => {
    const p = setup(); await screen.findByRole("img", { name: "second.png" });
    fireEvent.contextMenu(screen.getByLabelText(/Ctrl и колесо/));
    fireEvent.click(screen.getByRole("menuitem", { name: "Переслать" }));
    expect(p.onForward).toHaveBeenCalledWith(expect.objectContaining({ messageId: "second", chatId: "chat" }));
  });
  it("reports unavailable clipboard support without pretending that a copy succeeded", async () => {
    setup(); await screen.findByRole("img", { name: "second.png" });
    fireEvent.contextMenu(screen.getByLabelText(/Ctrl и колесо/));
    fireEvent.click(screen.getByRole("menuitem", { name: "Копировать" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Копирование изображения недоступно");
  });
  it("returns keyboard focus to the opening control when unmounted", async () => {
    render(<button type="button">Открыть фото</button>);
    const trigger = screen.getByRole("button", { name: "Открыть фото" }); trigger.focus();
    const p = setup(); await screen.findByRole("img", { name: "second.png" });
    p.view.unmount();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
