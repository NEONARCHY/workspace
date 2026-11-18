import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TripRequest } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripHrOrderForm } from "./TripHrOrderForm";

describe("HR order date", () => {
  afterEach(cleanup);

  const request: TripRequest = {
    id: "trip", number: "T-1", requesterUserId: "employee", orderNumber: "29", orderSeries: "а/ф",
    purpose: "Цель", destination: "Самарқанд", startDate: "2030-05-01", endDate: "2030-05-02",
    employeeIds: ["employee"], stage: "hr", stageLabel: "Кадровая служба", status: "running",
    statusLabel: "В работе", canEdit: false, allowedActions: ["complete"], actions: [],
    createdAt: "2030-04-27T00:00:00Z", updatedAt: "2030-04-27T00:00:00Z",
  };
  function setup(busy = false) {
    const onComplete = vi.fn(async () => false);
    render(<FluentProvider theme={webLightTheme}><TripHrOrderForm request={request}
      busy={busy} onComplete={onComplete} /></FluentProvider>);
    return onComplete;
  }

  it("omits an empty date so the server uses today", async () => {
    const onComplete = setup();
    fireEvent.click(screen.getByRole("button", { name: "Оформлено" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledExactlyOnceWith({
      orderNumber: "29", orderSeries: "а/ф", orderPurpose: "Цель",
    }));
  });

  it("sends the selected date and preserves it after refusal, with clearing back to today", async () => {
    const onComplete = setup();
    const date = screen.getByLabelText("Дата приказа (необязательно)");
    fireEvent.change(date, { target: { value: "2030-04-28" } });
    fireEvent.click(screen.getByRole("button", { name: "Оформлено" }));
    await waitFor(() => expect(onComplete).toHaveBeenLastCalledWith({
      orderNumber: "29", orderSeries: "а/ф", orderPurpose: "Цель", orderDate: "2030-04-28",
    }));
    expect(date).toHaveValue("2030-04-28");
    fireEvent.change(date, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Оформлено" }));
    await waitFor(() => expect(onComplete).toHaveBeenLastCalledWith({
      orderNumber: "29", orderSeries: "а/ф", orderPurpose: "Цель",
    }));
  });

  it("disables date editing and submission while saving", () => {
    const onComplete = setup(true);
    expect(screen.getByLabelText("Дата приказа (необязательно)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Оформляем…" })).toBeDisabled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("retains a real manual number when revising a trip with a historical route", () => {
    render(<FluentProvider theme={webLightTheme}><TripHrOrderForm revision
      request={{ ...request, hrProcessingRequired: false, orderManuallyRegistered: true }}
      busy={false} onComplete={vi.fn()} /></FluentProvider>);
    expect(screen.getByLabelText("Номер приказа *")).toHaveValue("29");
  });
});
