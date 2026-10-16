import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfFilePreview from "./PdfFilePreview";

const mocks = vi.hoisted(() => ({ load: vi.fn(), getPage: vi.fn(), render: vi.fn(), text: vi.fn(), destroy: vi.fn(), cancel: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument: mocks.load, GlobalWorkerOptions: {} }));
let width = 800, height = 600;
let resized: () => void = () => {};
const blob = () => {
  const value = new Blob(["pdf"]);
  Object.defineProperty(value, "arrayBuffer", { value: async () => new ArrayBuffer(3) });
  return value;
};
function setup(total = 12) {
  const pdf = { numPages: total, getPage: mocks.getPage };
  mocks.load.mockReturnValue({ promise: Promise.resolve(pdf), destroy: mocks.destroy });
  const onError = vi.fn();
  return { ...render(<PdfFilePreview blob={blob()} onError={onError} />), onError, pdf };
}
beforeEach(() => {
  width = 800; height = 600;
  mocks.destroy.mockResolvedValue(undefined);
  mocks.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: mocks.cancel }));
  mocks.text.mockResolvedValue({ items: [{ str: "Текст документа" }] });
  mocks.getPage.mockImplementation(async (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: (number === 2 ? 900 : 600) * scale, height: (number === 2 ? 600 : 900) * scale }),
    render: (options: unknown) => mocks.render(number, options), getTextContent: mocks.text, cleanup: vi.fn(),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("file-viewer-pdf-page") ? width : 0; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("file-viewer-pdf-page") ? height : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains("file-viewer-pdf-sheet")) return new DOMRect(0, 0, width, height);
    let top = 12 - (this.parentElement?.scrollTop ?? 0);
    let previous = this.previousElementSibling;
    while (previous) { top += parseFloat((previous.firstElementChild as HTMLElement).style.height) + 36; previous = previous.previousElementSibling; }
    return new DOMRect(12, top, parseFloat(this.style.width), parseFloat((this.firstElementChild as HTMLElement).style.height) + 20);
  });
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("continuous document reader", () => {
  it("zooms only the document with Ctrl/Command wheel, accumulates bursts and removes the listener", async () => {
    const view = setup(3);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(3, expect.anything()));
    const region = screen.getByRole("region", { name: "Страницы документа" });
    const first = screen.getByRole("group", { name: "Страница 1" });
    const original = parseFloat(first.style.width);
    expect(fireEvent.wheel(region, { deltaY: -100, cancelable: true })).toBe(true);
    expect(parseFloat(first.style.width)).toBe(original);
    act(() => {
      for (let index = 0; index < 2; index++) expect(region.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true }))).toBe(false);
    });
    await waitFor(() => expect(parseFloat(first.style.width)).toBeCloseTo(original * Math.exp(.4)));
    expect(screen.getByRole("button", { name: "Страница целиком" })).toHaveAttribute("aria-pressed", "false");
    expect(fireEvent.wheel(region, { deltaY: 100, metaKey: true, cancelable: true })).toBe(false);
    await waitFor(() => expect(parseFloat(first.style.width)).toBeCloseTo(original * Math.exp(.2)));
    act(() => { for (let index = 0; index < 30; index++) fireEvent.wheel(region, { deltaY: -100, ctrlKey: true }); });
    await waitFor(() => expect(screen.getByText("300%")).toBeInTheDocument());
    act(() => { for (let index = 0; index < 40; index++) fireEvent.wheel(region, { deltaY: 100, ctrlKey: true }); });
    await waitFor(() => expect(screen.getByText("10%")).toBeInTheDocument());
    view.unmount();
    expect(region.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true }))).toBe(true);
  });
  it("starts with the whole first page, prefills the next pages and bounds active canvases", async () => {
    const { onError } = setup();
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(3, expect.anything()));
    expect(screen.getByRole("button", { name: "Страница целиком" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("group", { name: /^Страница \d+$/ })).toHaveLength(12);
    const first = screen.getByRole("group", { name: "Страница 1" });
    expect(parseFloat((first.firstElementChild as HTMLElement).style.height)).toBeCloseTo(560);
    const second = screen.getByRole("group", { name: "Страница 2" });
    expect(parseFloat(second.style.width)).toBeLessThanOrEqual(width - 32);
    expect(document.querySelectorAll("canvas")).toHaveLength(3);
    const firstCanvas = first.querySelector("canvas")!;
    expect(mocks.text).not.toHaveBeenCalled();
    const region = screen.getByRole("region", { name: "Страницы документа" });
    const sixth = screen.getByRole("group", { name: "Страница 6" });
    region.scrollTop += sixth.getBoundingClientRect().top - 12;
    fireEvent.scroll(region);
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Страница PDF" })).toHaveValue(6));
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(8, expect.anything()));
    expect(document.querySelectorAll("canvas")).toHaveLength(5);
    expect(first.querySelector("canvas")).toBeNull();
    await waitFor(() => expect(firstCanvas.width).toBe(0));
    expect(firstCanvas.height).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(mocks.load.mock.calls[0]![0]).toMatchObject({ isEvalSupported: false, useSystemFonts: true });
  });

  it("refits on resize, supports width/manual zoom, page entry and accessible text", async () => {
    setup(3);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledWith(3, expect.anything()));
    width = 400; height = 360;
    act(() => resized());
    const first = screen.getByRole("group", { name: "Страница 1" });
    await waitFor(() => expect(parseFloat((first.firstElementChild as HTMLElement).style.height)).toBeCloseTo(320));
    fireEvent.click(screen.getByRole("button", { name: "По ширине" }));
    await waitFor(() => expect(parseFloat(first.style.width)).toBeCloseTo(368));
    fireEvent.click(screen.getByRole("button", { name: "Увеличить PDF" }));
    await waitFor(() => expect(parseFloat(first.style.width)).toBeGreaterThan(368));
    fireEvent.click(screen.getByRole("button", { name: "Страница целиком" }));
    const page = screen.getByRole("spinbutton", { name: "Страница PDF" });
    fireEvent.change(page, { target: { value: "3" } }); fireEvent.keyDown(page, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Текст страницы" }));
    expect(await screen.findByRole("region", { name: "Текст страницы 3" })).toBeInTheDocument();
    expect(await screen.findByText("Текст документа")).toBeInTheDocument();
    fireEvent.change(page, { target: { value: "99" } }); fireEvent.blur(page);
    expect(page).toHaveValue(3);
  });

  it("cancels page rendering and destroys the worker when closed", async () => {
    mocks.render.mockImplementation(() => {
      let reject: (reason: Error) => void = () => {};
      const promise = new Promise<void>((_, fail) => { reject = fail; });
      return { promise, cancel: () => { mocks.cancel(); reject(Object.assign(new Error("cancelled"), { name: "RenderingCancelledException" })); } };
    });
    const view = setup(1);
    await waitFor(() => expect(mocks.render).toHaveBeenCalled());
    view.unmount();
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalled());
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(view.onError).not.toHaveBeenCalled();
  });

  it("reports password protection without running document actions", async () => {
    const onError = vi.fn();
    mocks.load.mockReturnValue({ promise: Promise.reject(Object.assign(new Error("password"), { name: "PasswordException" })), destroy: mocks.destroy });
    render(<PdfFilePreview blob={blob()} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("защищён паролем")));
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("keeps good pages usable when one page fails and retries that page only", async () => {
    mocks.render.mockImplementation((number: number) => ({ promise: number === 2 ? Promise.reject(new Error("damaged")) : Promise.resolve(), cancel: mocks.cancel }));
    const { onError } = setup(3);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось отобразить страницу");
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Страница 1" }).querySelector("canvas")).toBeVisible();
    mocks.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: mocks.cancel }));
    fireEvent.click(screen.getByRole("button", { name: "Повторить страницу 2" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.destroy).not.toHaveBeenCalled();
  });
});
