import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentFields, emptyPaymentForm } from "./ApprovalsView";
import { workspaceTheme } from "./workspace-theme";

function Harness() {
  const [form, setForm] = useState(emptyPaymentForm("m1"));
  return <FluentProvider theme={workspaceTheme}><PaymentFields form={form} onChange={setForm}
    people={[]} calendarEvents={[]} targets={{ projects: [
      { id: "p1", title: "First", code: "P1" }, { id: "p2", title: "Other", code: "P2" },
    ], workstreams: [], items: [], budgetArticles: [
      { id: "a1", projectId: "p1", title: "Services", amount: "100.25", currency: "USD",
        funding: "donor", actualAmount: "0", remainingAmount: "100.25" },
      { id: "a3", projectId: "p1", title: "Local services", amount: "1000", currency: "UZS",
        funding: "own", actualAmount: "0", remainingAmount: "1000" },
      { id: "a2", projectId: "p2", title: "Private other", amount: "10", currency: "UZS",
        funding: "own", actualAmount: "0", remainingAmount: "10" },
    ] }} /></FluentProvider>;
}
afterEach(cleanup);
function select(name: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
describe("payment budget selection", () => {
  it("offers project articles in any currency without changing the payment currency", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "бюджетная статья" })).toBeDisabled();
    select("проект", "P1 · First");
    fireEvent.click(screen.getByRole("combobox", { name: "бюджетная статья" }));
    expect(screen.getByRole("option", { name: /Services · остаток 100.25 USD/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Local services/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Services · остаток 100.25 USD" }));
    expect(screen.getByRole("combobox", { name: "валюта оплаты" })).toHaveTextContent("UZS");
    expect(screen.getByText(/Валюта оплаты отличается от валюты плана статьи/)).toBeInTheDocument();
    select("валюта оплаты", "USD");
    expect(screen.getByRole("combobox", { name: "валюта оплаты" })).toHaveTextContent("USD");
    expect(screen.getByRole("combobox", { name: "бюджетная статья" })).toHaveTextContent("Services");
    select("проект", "P2 · Other");
    expect(screen.getByRole("combobox", { name: "бюджетная статья" })).toHaveTextContent("Без статьи");
    fireEvent.click(screen.getByRole("combobox", { name: "бюджетная статья" }));
    expect(screen.queryByRole("option", { name: /Services/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Private other/ })).toBeInTheDocument();
    select("валюта оплаты", "UZS");
    expect(screen.getByRole("combobox", { name: "бюджетная статья" })).toHaveTextContent("Без статьи");
  });
  it("keeps the selected article when payment currency is explicitly changed", () => {
    render(<Harness />);
    select("проект", "P1 · First");
    select("валюта оплаты", "USD");
    select("бюджетная статья", "Services · остаток 100.25 USD");
    select("валюта оплаты", "UZS");
    expect(screen.getByRole("combobox", { name: "бюджетная статья" })).toHaveTextContent("Services");
  });
});
