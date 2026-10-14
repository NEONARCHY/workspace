// Synthetic data only. All API requests are intercepted by the smoke runner.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import type { ChatMessage, WorkspacePerson, ZoomInvitation } from "@yuksalish/contracts";
import { ZoomInvitationCard } from "../src/renderer/ZoomInvitationCard";
import { useQaTheme } from "./color-theme";
import "../src/renderer/styles.css";
import "../src/renderer/design-system.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/satin-surfaces.css";

const people: WorkspacePerson[] = Array.from({ length: 31 }, (_, i) => ({
  id: `qa-${i}`, username: `qa-${i}`, name: i ? `Приглашённый сотрудник ${i}` : "Организатор встречи", initials: "QA", role: "employee", color: "brand",
}));
const starts = new Date(Date.now() + 86400000);
const invitation: ZoomInvitation = {
  meetingId: "qa-meeting", topic: "Обсуждение запуска региональной программы", startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 3600000).toISOString(),
  timezone: "Asia/Tashkent", status: "scheduled", organizerId: "qa-0", participants: people.slice(1).map(p => ({ userId: p.id, response: "pending" })),
  joinUrl: "https://zoom.us/j/123456789", passcode: "1234", response: "pending", canRespond: true, available: true,
};
// The mock response is stored in this QA module, never the real API.
const request = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/zoom-response")) {
    const response = JSON.parse(String(init?.body)).response as "accepted" | "declined";
    return new Response(JSON.stringify({ id: "qa-message", zoomInvitation: { ...invitation, response } } satisfies Partial<ChatMessage>), { status: 200, headers: { "content-type": "application/json" } });
  }
  return request(input, init);
};
function Fixture() {
  const theme = useQaTheme();
  const [state, setState] = useState("scheduled");
  return <FluentProvider theme={theme} className="app-provider" style={{ minHeight: "100vh", padding: 16, height: "auto", overflow: "auto" }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>{["scheduled", "cancelled", "withdrawn", "finished"].map(value => <button key={value} onClick={() => setState(value)}>{value}</button>)}</div>
    <div className="messenger-view" style={{ display: "block", width: 660, maxWidth: "100%", padding: 12, boxSizing: "border-box" }}>
      <div className="message"><div className="message-content"><div className="message-body has-rich-content"><strong>Организатор встречи</strong>
        <ZoomInvitationCard messageId="qa-message" invitation={{ ...invitation, status: state === "cancelled" ? state : "scheduled", available: state !== "withdrawn", endsAt: state === "finished" ? new Date(Date.now() - 60000).toISOString() : invitation.endsAt }} people={people} token="qa" />
        <span className="message-meta">14:48</span></div></div></div>
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
