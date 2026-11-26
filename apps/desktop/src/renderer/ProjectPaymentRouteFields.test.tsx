import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePerson } from "@yuksalish/contracts";
import { ProjectPaymentRouteFields } from "./ProjectPaymentRouteFields";
import { workspaceTheme } from "./workspace-theme";

const people: WorkspacePerson[] = [
  { id: "deputy", username: "deputy", name: "Заместитель", initials: "З", role: "employee", jobTitle: "Rais o‘rinbosari", color: "#0091A8" },
  { id: "first", username: "first", name: "Первый зам", initials: "ПЗ", role: "employee", jobTitle: "Rais birinchi o‘rinbosari", color: "#0091A8" },
  { id: "accountant", username: "accountant", name: "Бухгалтер", initials: "Б", role: "employee", jobTitle: "Bosh hisobchi", color: "#0091A8" },
  { id: "assistant", username: "assistant", name: "Помощник", initials: "П", role: "employee", jobTitle: "Rais o‘rinbosari yordamchisi", color: "#0091A8" },
];

afterEach(cleanup);

describe("project payment route", () => {
  it("keeps all other stages, selects only deputies and preserves their order", () => {
    const changed = vi.fn();
    function Harness() {
      const [value, setValue] = useState<readonly string[] | null>(null);
      return <FluentProvider theme={workspaceTheme}><ProjectPaymentRouteFields people={people}
        value={value} onChange={(ids) => { changed(ids); setValue(ids); }} disabled={false} /></FluentProvider>;
    }
    render(<Harness />);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText(/включая особый маршрут «Субсидии»/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Маршрут оплаты после главбуха" }), { target: { value: "custom" } });
    expect(screen.getByRole("status")).toHaveTextContent("Главбух → Председатель");
    expect(screen.getByText(/Работа с членами Юксалиш, финансисты, помощник, главбух/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Добавить заместителя в маршрут оплаты" }));
    expect(screen.queryByRole("button", { name: /Бухгалтер/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Помощник/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Заместитель/ }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить заместителя в маршрут оплаты" }));
    fireEvent.click(screen.getByRole("button", { name: /Первый зам/ }));
    expect(changed).toHaveBeenLastCalledWith(["deputy", "first"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Маршрут оплаты после главбуха" }), { target: { value: "custom" } });
    expect(changed).toHaveBeenLastCalledWith(["deputy", "first"]);
    expect(screen.getByRole("status")).toHaveTextContent("Главбух → Заместитель → Первый зам → Председатель");
    fireEvent.click(screen.getByRole("button", { name: "Выше: Первый зам" }));
    expect(changed).toHaveBeenLastCalledWith(["first", "deputy"]);
    fireEvent.click(screen.getByRole("button", { name: "Убрать из маршрута оплаты: Заместитель" }));
    expect(changed).toHaveBeenLastCalledWith(["first"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Маршрут оплаты после главбуха" }), { target: { value: "legacy" } });
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it("shows the saved direct route and disables edits while saving", () => {
    render(<FluentProvider theme={workspaceTheme}><ProjectPaymentRouteFields people={people}
      value={[]} onChange={vi.fn()} disabled /></FluentProvider>);
    const section = screen.getByRole("group", { name: "Согласование заявок на оплату" });
    expect(within(section).getByRole("combobox")).toBeDisabled();
    expect(within(section).getByRole("button", { name: "Добавить заместителя в маршрут оплаты" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Главбух → Председатель");
  });
});
