import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoginView } from "./LoginView";

afterEach(cleanup);

function loginProps() {
  return {
    busy: false,
    onLogin: vi.fn().mockResolvedValue(undefined),
    onAcceptInvitation: vi.fn().mockResolvedValue(undefined),
    onCompletePasswordReset: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Login second-factor disclosure", () => {
  it("starts collapsed and lets ordinary users sign in without a code", () => {
    const props = loginProps();
    render(<LoginView {...props} />);
    const summary = screen.getByText("Двухфакторная авторизация");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("Код приложения-аутентификатора")).not.toBeVisible();
    expect(screen.getByText("Нужен только при включённом TOTP")).not.toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Логин/), { target: { value: "sample-user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "sample-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(props.onLogin).toHaveBeenCalledWith("sample-user", "sample-password", undefined);
  });

  it("reveals the optional field and preserves a numeric code across collapse", () => {
    const props = loginProps();
    render(<LoginView {...props} />);
    const summary = screen.getByText("Двухфакторная авторизация");
    fireEvent.click(summary);
    const input = screen.getByLabelText("Код приложения-аутентификатора");
    expect(input).toBeVisible();
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(input, { target: { value: "12a3456" } });
    fireEvent.click(summary);
    expect(input).not.toBeVisible();
    fireEvent.click(summary);
    expect(input).toHaveValue("123456");
    fireEvent.change(screen.getByLabelText(/^Логин/), { target: { value: "sample-user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "sample-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(props.onLogin).toHaveBeenCalledWith("sample-user", "sample-password", "123456");
  });

  it.each([
    "Введите шестизначный код приложения-аутентификатора.",
    "Код неверный или уже использован.",
    "TOTP code required",
    "Invalid or already used TOTP code",
  ])("opens and focuses the field when the server reports %s", (error) => {
    const props = loginProps();
    const { rerender } = render(<LoginView {...props} />);
    rerender(<LoginView {...props} error={error} />);
    const input = screen.getByLabelText("Код приложения-аутентификатора");
    expect(input).toBeVisible();
    expect(input).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(error);
  });

  it("does not open for password errors or show a second factor in other modes", () => {
    render(<LoginView {...loginProps()} error="Неверный логин или пароль." />);
    expect(screen.getByLabelText("Код приложения-аутентификатора")).not.toBeVisible();
    for (const mode of ["Активация приглашения", "Сброс доступа"]) {
      fireEvent.click(screen.getByRole("button", { name: mode }));
      expect(screen.queryByText("Двухфакторная авторизация")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Повторите пароль/)).toBeVisible();
    }
    fireEvent.click(screen.getByRole("button", { name: "Вход" }));
    expect(screen.getByLabelText("Код приложения-аутентификатора")).not.toBeVisible();
  });
});
