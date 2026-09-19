import { render, screen, waitFor } from "@testing-library/react";
import { setInterfaceLocale } from "@yuksalish/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { InterfaceLocalization } from "./InterfaceLocalization";

describe("InterfaceLocalization", () => {
  afterEach(() => setInterfaceLocale("ru"));

  it("translates visible and accessible interface text and restores Russian", async () => {
    render(<><InterfaceLocalization /><button title="Настройки">Заявки на оплату</button></>);
    setInterfaceLocale("uz_latn");
    await waitFor(() => expect(screen.getByText("To‘lov arizalari")).toHaveAttribute("title", "Sozlamalar"));
    setInterfaceLocale("ru");
    await waitFor(() => expect(screen.getByText("Заявки на оплату")).toHaveAttribute("title", "Настройки"));
  });
});
