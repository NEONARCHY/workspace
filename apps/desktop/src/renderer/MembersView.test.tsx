import { render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { describe, expect, it, vi } from "vitest";

import { MembersView } from "./MembersView";
import { workspaceTheme } from "./workspace-theme";

describe("MembersView", () => {
  it("shows real registry records and reference filters", async () => {
    render(<FluentProvider theme={workspaceTheme}><MembersView loading={false} onRefresh={vi.fn()} registry={{
      configured: true,
      generatedAt: "2026-01-31T09:00:00+05:00",
      members: [
        { id: 1, firstName: "Бахтиёр", lastName: "Самугов", username: "baxtiyor", status: "active", createdAt: "2026-01-20T09:00:00+05:00", regionId: 13, regionNameRu: "Ташкент", sphereId: 2, sphereNameRu: "Государственный служащий", gender: "male" },
        { id: 2, firstName: "Темур", lastName: "Алмазов", username: "temur", status: "active", createdAt: "2026-01-30T09:00:00+05:00", regionId: 14, regionNameRu: "Самарканд", sphereId: 2, sphereNameRu: "Государственный служащий", gender: "male" },
        { id: 3, firstName: "Старый", lastName: "Участник", username: "old", status: "active", createdAt: "2025-12-20T09:00:00+05:00", regionId: 13, regionNameRu: "Ташкент", sphereId: 2, sphereNameRu: "Государственный служащий", gender: "male" },
      ],
      regions: [{ id: 13, nameRu: "Ташкент", nameUz: "Toshkent shahri" }, { id: 14, nameRu: "Самарканд", nameUz: "Samarqand viloyati" }],
      spheres: [{ id: 2, nameRu: "Государственный служащий", nameUz: "Davlat xizmatchisi" }],
    }} /></FluentProvider>);

    expect(screen.getByRole("heading", { name: "Работа с членами" })).toBeInTheDocument();
    expect(screen.getByText("Бахтиёр Самугов")).toBeInTheDocument();
    expect(screen.getByLabelText("Фильтр по региону")).toHaveTextContent("Все регионы");
    await waitFor(() => {
      expect(screen.getByLabelText("Сводка текущей выборки")).toHaveTextContent(
        /2\s*в текущей выборке/,
      );
    });
    expect(screen.getByLabelText("Дата регистрации с")).toHaveValue("2026-01-01");
    const ranking = screen.getByRole("heading", { name: "Рейтинг регионов" }).closest("section");
    if (!ranking) throw new Error("Рейтинг регионов не найден");
    expect(within(ranking).getByText("Самарканд")).toBeInTheDocument();
  });
});
