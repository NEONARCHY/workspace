import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";


describe("desktop shell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the local module catalog when the API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);

    expect(screen.getAllByText("Сообщения")).toHaveLength(2);
    await waitFor(() => expect(screen.getByText("Локальный режим")).toBeInTheDocument());
  });

  it("switches the shell to Uzbek Latin", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<App />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "uz_latn" } });
    expect(screen.getByText("Ish maydoni")).toBeInTheDocument();
    expect(screen.getAllByText("Xabarlar")).toHaveLength(2);
  });
});
