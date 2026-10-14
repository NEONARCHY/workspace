import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import type { ChatMessage, ZoomInvitation } from "@yuksalish/contracts";
import { ZoomInvitationCard } from "./ZoomInvitationCard";
import { workspaceTheme } from "./workspace-theme";
import { respondToZoomInvitation } from "./workspace-api";

vi.mock("./workspace-api", () => ({ respondToZoomInvitation: vi.fn() }));
const start = new Date(Date.now() + 86400000);
const invitation: ZoomInvitation = {
  meetingId: "meeting", topic: "Обсуждение проекта", startsAt: start.toISOString(),
  endsAt: new Date(start.getTime() + 3600000).toISOString(), timezone: "Asia/Tashkent",
  status: "scheduled", organizerId: "owner", participants: [{ userId: "peer", response: "pending" }],
  joinUrl: "https://us06web.zoom.us/j/123456", passcode: "abcd", response: "pending", canRespond: true, available: true,
};
const mount = (card = invitation) => render(<FluentProvider theme={workspaceTheme}><ZoomInvitationCard messageId="msg" invitation={card} people={[]} token="test" /></FluentProvider>);
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);
describe("Zoom invitation", () => {
  it("renders the date, safe link and accessible bounded participant disclosure", () => {
    mount();
    expect(screen.getByRole("heading", { name: invitation.topic })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ссылка на конференцию/ })).toHaveAttribute("href", invitation.joinUrl);
    const toggle = screen.getByRole("button", { name: /Участники/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Организатор")).toBeInTheDocument();
    expect(screen.getByText("Приглашён")).toBeInTheDocument();
  });
  it("persists acceptance before showing confirmation and joins through a real link", async () => {
    vi.mocked(respondToZoomInvitation).mockResolvedValue({ zoomInvitation: { ...invitation, response: "accepted" } } as ChatMessage);
    mount(); fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    await waitFor(() => expect(respondToZoomInvitation).toHaveBeenCalledWith("test", "msg", "accepted"));
    expect(await screen.findByText("Вы участвуете")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Войти в Zoom" })).toHaveAttribute("rel", "noopener noreferrer");
  });
  it("saves decline, prevents duplicates and allows accepting again", async () => {
    vi.mocked(respondToZoomInvitation).mockResolvedValue({ zoomInvitation: { ...invitation, response: "declined" } } as ChatMessage);
    mount(); fireEvent.click(screen.getByRole("button", { name: "Отказаться" }));
    expect(await screen.findByRole("button", { name: "Отказались" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Принять" })).toBeEnabled();
  });
  it("keeps the pending state and retry controls after a failed response", async () => {
    vi.mocked(respondToZoomInvitation).mockRejectedValue(new Error("Сеть недоступна"));
    mount(); fireEvent.click(screen.getByRole("button", { name: "Принять" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(screen.queryByText("Вы участвуете")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Принять" })).toBeEnabled();
  });
  it.each(["cancelled", "failed"])("does not join or respond to a %s meeting", status => {
    mount({ ...invitation, status });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Принять" })).not.toBeInTheDocument();
  });
  it("withdraws links and attendee details when the invitation is no longer available", () => {
    mount({ ...invitation, available: false, participants: [], joinUrl: null, passcode: null });
    expect(screen.getByText("Вы больше не приглашены на эту встречу.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("does not follow non-Zoom and non-HTTPS links", () => {
    mount({ ...invitation, joinUrl: "javascript:alert(1)" });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
