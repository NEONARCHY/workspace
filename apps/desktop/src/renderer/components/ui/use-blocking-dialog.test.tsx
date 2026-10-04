import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useBlockingDialog } from "./use-blocking-dialog";

const WindowState = () => <output>{useBlockingDialog() ? "paused" : "running"}</output>;
afterEach(() => { cleanup(); document.querySelectorAll("[data-qa-window]").forEach((node) => node.remove()); });
const addWindow = (className: string) => {
  const dialog = document.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.dataset.qaWindow = "true";
  dialog.className = className;
  document.body.append(dialog);
  return dialog;
};
it("ignores the assistant's own panel and pauses until all foreign windows close", async () => {
  const assistant = addWindow("assistant-panel");
  render(<WindowState />);
  expect(screen.getByText("running")).toBeInTheDocument();
  const first = addWindow("fui-DialogSurface");
  const second = addWindow("account-dialog");
  await screen.findByText("paused");
  first.remove();
  expect(screen.getByText("paused")).toBeInTheDocument();
  second.remove();
  await screen.findByText("running");
  assistant.remove();
});
it("reacts to hidden state and custom composer backdrops", async () => {
  render(<WindowState />);
  const dialog = addWindow("record-composer-backdrop");
  await screen.findByText("paused");
  dialog.hidden = true;
  await screen.findByText("running");
  dialog.hidden = false;
  await screen.findByText("paused");
  dialog.removeAttribute("role");
  await waitFor(() => expect(screen.getByText("paused")).toBeInTheDocument());
  dialog.className = "ordinary-panel";
  await screen.findByText("running");
});
it("pauses for confirmation alert dialogs as well", async () => {
  render(<WindowState />);
  const confirmation = addWindow("desktop-update-confirm");
  confirmation.setAttribute("role", "alertdialog");
  await screen.findByText("paused");
  confirmation.remove();
  await screen.findByText("running");
});
