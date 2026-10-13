import type { CalendarEvent, ZoomMeeting } from "@yuksalish/contracts";

export function sampleEvent(id: string, changes: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, description: "", eventType: "meeting", organizerUserId: "organizer", attendeeIds: ["me"], attendees: [],
    startsAt: "2026-10-13T09:00:00", endsAt: "2026-10-13T10:00:00", allDay: false, location: "", status: "scheduled",
    canRespond: false, canEdit: false, createdAt: "2026-10-01T09:00:00", updatedAt: "2026-10-01T09:00:00", ...changes };
}
export function sampleZoom(changes: Partial<ZoomMeeting> = {}): ZoomMeeting {
  return { id: "zoom", topic: "Zoom-сессия", description: "", startsAt: "2026-10-13T08:00:00", endsAt: "2026-10-13T09:00:00",
    durationMinutes: 60, organizerUserId: "organizer", organizerName: "Организатор", participantIds: ["colleague"],
    status: "scheduled", source: "workspace", canEdit: false, canCancel: false, ...changes };
}
