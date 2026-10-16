import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopbarInsights } from "./TopbarInsights";
import { workspaceTheme } from "./workspace-theme";
import { loadExchangeRates, loadUzbekistanWeather } from "./workspace-api";
import { contextRates, contextWeather } from "../../qa/context-fixtures";

vi.mock("./workspace-api", () => ({ loadExchangeRates: vi.fn(), loadUzbekistanWeather: vi.fn() }));
beforeEach(() => {
  vi.mocked(loadExchangeRates).mockResolvedValue(contextRates);
  vi.mocked(loadUzbekistanWeather).mockResolvedValue(contextWeather);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const mount = () => render(<FluentProvider theme={workspaceTheme}><TopbarInsights token="test" /></FluentProvider>);

describe("topbar insights", () => {
  it.each(["rates", "weather"])("keeps focus and close/reopen lifecycle without Fluent fade: %s", async kind => {
    mount();
    const trigger = await screen.findByRole("button", { name: kind === "rates" ? /Курсы валют: 1 USD — 12.*000 UZS/ : /Погода в Ташкенте: 13,3/ });
    const title = kind === "rates" ? "Курсы валют" : "Погода Узбекистана";
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog", { name: title });
    expect(panel).toHaveAttribute("data-surface-resize-motion", "off");
    expect(panel.style.height).toBe("");
    expect(panel.querySelector(".context-panel-head")?.parentElement).toBe(panel);
    expect(panel.querySelector<HTMLElement>(".context-panel-body")?.style.height).toBe("");
    fireEvent.click(within(panel).getByRole("button", { name: kind === "rates" ? "Закрыть курсы валют" : "Закрыть погоду" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog", { name: title });
    fireEvent.keyDown(reopened, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it("defaults to USD/UZS and Tashkent, with real keyboard triggers", async () => {
    mount();
    expect(await screen.findByRole("button", { name: /Курсы валют: 1 USD — 12.*000 UZS/ })).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByRole("button", { name: /Погода в Ташкенте: 13,3 градусов/ })).toBeEnabled();
  });
  it("converts the selected currency while keeping USD in the bar", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Курсы валют: 1 USD — 12.*000 UZS/ }));
    const panel = await screen.findByRole("dialog", { name: "Курсы валют" });
    expect(panel).toHaveStyle({ overflowY: "hidden" });
    fireEvent.click(within(panel).getByRole("button", { name: /EUR Евро/ }));
    fireEvent.change(within(panel).getByRole("textbox", { name: "Сумма в EUR" }), { target: { value: "2,5" } });
    expect(within(panel).getByRole("status")).toHaveTextContent(/33.*750 UZS/);
    expect(screen.getByRole("button", { name: /Курсы валют: 1 USD/ })).toBeInTheDocument();
    fireEvent.change(within(panel).getByRole("textbox", { name: "Сумма в EUR" }), { target: { value: "bad" } });
    expect(within(panel).getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(within(panel).getByRole("status")).toHaveTextContent("Введите сумму");
  });
  it("drills into one of 12 regions and restores list focus on return", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Погода в Ташкенте: 13,3/ }));
    const panel = await screen.findByRole("dialog", { name: "Погода Узбекистана" });
    expect(panel).toHaveStyle({ overflowY: "hidden" });
    expect(within(panel).getAllByRole("button", { name: /^Погода:/ })).toHaveLength(13);
    fireEvent.click(within(panel).getByRole("button", { name: "Погода: Ташкентская область" }));
    const back = within(panel).getByRole("button", { name: "К списку областей" });
    expect(back).toHaveFocus();
    expect(within(panel).getByText(/^Ощущается как/)).toHaveTextContent("Нурафшан");
    expect(within(panel).getByRole("region", { name: "Качество воздуха" })).toHaveTextContent("US AQI");
    fireEvent.click(back);
    expect(within(panel).getByRole("button", { name: "Погода: Ташкентская область" })).toHaveFocus();
  });
  it("shows source failures and recovers only after a successful read", async () => {
    vi.mocked(loadExchangeRates).mockRejectedValueOnce(new Error("ЦБ недоступен"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Курсы валют: 1 USD — нет данных/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ЦБ недоступен");
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Курсы валют: 1 USD — 12.*000/ })).toBeInTheDocument();
  });
  it("marks cached data and keeps weather separate from unavailable air quality", async () => {
    vi.mocked(loadExchangeRates).mockResolvedValue({ ...contextRates, stale: true });
    vi.mocked(loadUzbekistanWeather).mockResolvedValue({ ...contextWeather, airStale: true,
      locations: contextWeather.locations.map(place => ({ ...place, air: null })) });
    mount();
    expect(await screen.findByRole("button", { name: /Курсы валют.*Данные устарели/ })).toHaveAttribute("data-stale", "true");
    fireEvent.click(await screen.findByRole("button", { name: /Погода в Ташкенте: 13,3/ }));
    expect(await screen.findByText("Данные качества воздуха временно недоступны.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Погода: Ташкент" })).toHaveTextContent("13°");
  });
  it("does not call the last failed read fresh while a retry is pending", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Курсы валют: 1 USD — 12.*000/ }));
    vi.mocked(loadExchangeRates).mockRejectedValueOnce(new Error("Источник недоступен"));
    screen.getByRole("button", { name: "Обновить" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Источник недоступен");
    let finish!: (value: typeof contextRates) => void;
    vi.mocked(loadExchangeRates).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(screen.getByRole("button", { name: /Курсы валют.*Данные устарели/, hidden: true })).toHaveAttribute("data-stale", "true");
    finish(contextRates);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Курсы валют:/, hidden: true })).not.toHaveAttribute("data-stale"));
  });
});
