import { act, cleanup, render } from "@testing-library/react";
import { DialogSurface, FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceDialog, focusWorkspaceDialog } from "./WorkspaceDialog";
import { workspaceTheme } from "./workspace-theme";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("activates a real control instead of a focus sentinel and preserves an active input", () => {
  const surface = document.createElement("div");
  surface.setAttribute("role", "dialog");
  surface.setAttribute("aria-hidden", "true");
  surface.innerHTML = '<i data-tabster-dummy tabindex="0"></i><button type="button">Закрыть</button><input />';
  document.body.append(surface);
  try {
    focusWorkspaceDialog(surface);
    expect(surface.querySelector("button")).toHaveFocus();
    surface.removeAttribute("aria-hidden");
    const input = surface.querySelector("input")!;
    input.focus();
    focusWorkspaceDialog(surface);
    expect(input).toHaveFocus();
  } finally { surface.remove(); }
});

it("reports closure only after an opened controlled dialog actually exits", async () => {
  vi.useFakeTimers();
  const closed = vi.fn(), opened = vi.fn();
  const view = (open: boolean) => <FluentProvider theme={workspaceTheme}>
    <WorkspaceDialog open={open} onAfterClose={closed} onAfterOpen={opened}>
      <DialogSurface aria-label="Проверка жизненного цикла"><button type="button">Закрыть</button></DialogSurface>
    </WorkspaceDialog>
  </FluentProvider>;
  const mounted = render(view(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(closed).not.toHaveBeenCalled();
  mounted.rerender(view(true));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(opened).toHaveBeenCalledOnce();
  mounted.rerender(view(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(closed).toHaveBeenCalledOnce();
  mounted.rerender(view(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(closed).toHaveBeenCalledOnce();
});
