import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyLogo } from "./CompanyLogo";
import { LoginView } from "./LoginView";

afterEach(cleanup);
describe("Company branding", () => {
  it("uses original local variants with preserved proportions and an accessible name", () => {
    const { rerender } = render(<CompanyLogo tone="white" className="auth-brand" />);
    const logo = screen.getByRole("img", { name: "Yuksalish" });
    expect(logo).toHaveAttribute("src", expect.stringContaining("yuksalish-logo-white.png"));
    expect(logo).toHaveAttribute("width", "3058");
    expect(logo).toHaveAttribute("height", "1010");
    expect(logo).toHaveAttribute("draggable", "false");
    rerender(<CompanyLogo tone="color" />);
    expect(logo).toHaveAttribute("src", expect.stringContaining("yuksalish-logo-color.png"));
  });
  it("removes only the requested paragraph in every login mode and keeps the logo", () => {
    const onLogin = vi.fn();
    render(<LoginView busy={false} onLogin={onLogin} onAcceptInvitation={vi.fn()} onCompletePasswordReset={vi.fn()} />);
    for (const mode of ["Активация приглашения", "Сброс доступа", "Вход"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      expect(screen.queryByText(/Сообщения, задачи и согласования доступны только после входа/)).not.toBeInTheDocument();
      expect(screen.queryByText(/получает отдельную отзываемую сессию/)).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Yuksalish" })).toHaveClass("auth-brand");
    }
    fireEvent.change(screen.getByLabelText(/^Логин/), { target: { value: "test-user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(onLogin).toHaveBeenCalledWith("test-user", "test-password", undefined);
  });
});
