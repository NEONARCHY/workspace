import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MessageTextAnimate } from "./MessageTextAnimate";

afterEach(cleanup);
it("starts new text at blur 10px and slide 20px with one accessible copy", () => {
  const { container } = render(<MessageTextAnimate enabled disabled={false}>Первое второе</MessageTextAnimate>);
  expect(container.querySelector("[data-text-animation]")).toHaveAttribute("data-text-animation", "enter");
  expect(container.querySelector(".message-text-word")).toHaveStyle({ filter: "blur(10px)", opacity: "0" });
  expect(container.querySelector(".message-text-word")).toHaveStyle({ top: "20px" });
  expect(container.querySelector(".sr-only")).toHaveTextContent("Первое второе");
  expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("Первое второе");
});
it("starts reverse sending from readable words", () => {
  const { container } = render(<MessageTextAnimate enabled disabled={false} outgoing>Первое второе</MessageTextAnimate>);
  expect(container.querySelector("[data-text-animation]")).toHaveAttribute("data-text-animation", "exit");
  expect(container.querySelector(".message-text-word")).toHaveStyle({ filter: "blur(0px)", opacity: "1" });
});
it("bounds animated word nodes for long messages without dropping text", () => {
  const text = Array.from({ length: 1000 }, (_, index) => `слово${index}`).join(" ");
  const { container } = render(<MessageTextAnimate enabled disabled={false}>{text}</MessageTextAnimate>);
  expect(container.querySelectorAll(".message-text-word")).toHaveLength(160);
  expect(container.querySelectorAll(".message-text-tail")).toHaveLength(1);
  expect(container.querySelector(".sr-only")!.textContent).toBe(text);
  expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe(text);
});
it("keeps history and reduced-motion text immediate and does not replay after re-enabling motion", () => {
  const view = render(<MessageTextAnimate enabled disabled>Без эффекта</MessageTextAnimate>);
  expect(view.container).toHaveTextContent("Без эффекта");
  expect(view.container.querySelector("[data-text-animation]")).toBeNull();
  view.rerender(<MessageTextAnimate enabled disabled={false}>Без эффекта</MessageTextAnimate>);
  expect(view.container.querySelector("[data-text-animation]")).toBeNull();
});
