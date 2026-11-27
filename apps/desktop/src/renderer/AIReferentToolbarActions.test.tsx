import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { AIReferentToolbarActions } from "./AIReferentToolbarActions";

afterEach(cleanup);

it("waits for an explicitly pending toolbar target and preserves standalone actions", () => {
  const target = document.createElement("div");
  document.body.append(target);
  try {
    const view = render(<AIReferentToolbarActions target={null}><button>Обновить</button></AIReferentToolbarActions>);
    expect(screen.queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
    view.rerender(<AIReferentToolbarActions target={target}><button>Обновить</button></AIReferentToolbarActions>);
    expect(within(target).getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    view.rerender(<AIReferentToolbarActions><button>Обновить</button></AIReferentToolbarActions>);
    expect(within(view.container).getByRole("button", { name: "Обновить" })).toBeInTheDocument();
    expect(within(target).queryByRole("button", { name: "Обновить" })).not.toBeInTheDocument();
  } finally {
    target.remove();
  }
});
