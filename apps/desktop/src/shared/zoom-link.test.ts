import { describe, expect, it } from "vitest";
import { validatedZoomLink } from "./zoom-link";

describe("restricted Zoom meeting links", () => {
  it.each([
    "https://zoom.us/j/123456789", "https://us06web.zoom.us/j/12345678901?pwd=abc",
    "https://team.zoom.com/wc/join/123456789", "https://zoomgov.com/j/123456789",
  ])("allows the meeting URL %s", url => expect(validatedZoomLink(url)).toBe(url));
  it.each([
    undefined, null, {}, "javascript:alert(1)", "file:///C:/Windows/system32/cmd.exe",
    "zoommtg://zoom.us/join?confno=123456789", "http://zoom.us/j/123456789",
    "https://zoom.us.evil.test/j/123456789", "https://evilzoom.us/j/123456789",
    "https://zoom.us@evil.test/j/123456789", "https://evil@zoom.us/j/123456789",
    "https://zoom.us:8443/j/123456789", "https://zoom.us/download",
    "https://127.0.0.1/j/123456789", "https://zoom.us/j/not-a-meeting",
    "https://zoom.us/j/123456789\n", "https://zoom.us/j/123456789?pwd=" + "x".repeat(2100),
  ])("rejects arbitrary or malformed navigation: %s", url => expect(validatedZoomLink(url)).toBeNull());
});
