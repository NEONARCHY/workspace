import { render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { describe, expect, it, vi } from "vitest";

import { MembersView } from "./MembersView";
import { workspaceTheme } from "./workspace-theme";

describe("MembersView", () => {
  it("shows real registry records and reference filters", () => {
    render(<FluentProvider theme={workspaceTheme}><MembersView loading={false} onRefresh={vi.fn()} registry={{
      configured: true,
      members: [{ id: 1, firstName: "Бахтиёр", lastName: "Самугов", username: "baxtiyor", status: "active", createdAt: "2026-01-01T09:00:00+05:00", regionId: 13, regionNameRu: "Ташкент", sphereId: 2, sphereNameRu: "Государственный служащий", gender: "male" }],
      regions: [{ id: 13, nameRu: "Ташкент", nameUz: "Toshkent shahri" }],
      spheres: [{ id: 2, nameRu: "Государственный служащий", nameUz: "Davlat xizmatchisi" }],
    }} /></FluentProvider>);

    expect(screen.getByRole("heading", { name: "Работа с членами" })).toBeInTheDocument();
    expect(screen.getByText("Бахтиёр Самугов")).toBeInTheDocument();
    expect(screen.getByLabelText("Фильтр по региону")).toHaveTextContent("Все регионы");
    expect(screen.getByText("1 в текущей выборке")).toBeInTheDocument();
  });
});
