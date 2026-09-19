import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { loadLinkPreview } from "./workspace-api";
import { extractMessageLinks, MessageLinkPreviews } from "./MessageLinkPreviews";

vi.mock("./workspace-api", () => ({ loadLinkPreview: vi.fn() }));

describe("message link previews", () => {
  it("extracts unique links and removes sentence punctuation", () => {
    expect(extractMessageLinks("Смотри https://example.com/a, и https://youtu.be/abc12345. https://example.com/a"))
      .toEqual(["https://example.com/a", "https://youtu.be/abc12345"]);
  });

  it("limits one message to three previews", () => {
    expect(extractMessageLinks("https://a.test https://b.test https://c.test https://d.test"))
      .toHaveLength(3);
  });

  it("renders an official Instagram embed with an external fallback", async () => {
    vi.mocked(loadLinkPreview).mockResolvedValue({
      url: "https://www.instagram.com/reels/example/",
      canonicalUrl: "https://www.instagram.com/reels/example/",
      kind: "instagram",
      title: "Публикация Instagram",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      embedUrl: "https://www.instagram.com/reel/example/embed/captioned/",
    });

    render(<MessageLinkPreviews body="https://www.instagram.com/reels/example/" token="token" />);

    expect(await screen.findByTitle("Публикация Instagram")).toHaveAttribute(
      "src", "https://www.instagram.com/reel/example/embed/captioned/",
    );
    expect(screen.getByRole("link", { name: /Открыть в Instagram/u }))
      .toHaveAttribute("href", "https://www.instagram.com/reels/example/");
  });

  it("adds origin and player API parameters to YouTube embeds", async () => {
    vi.mocked(loadLinkPreview).mockResolvedValue({
      url: "https://youtu.be/dQw4w9WgXcQ",
      canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      kind: "youtube",
      title: "Видео YouTube",
      description: "",
      siteName: "YouTube",
      imageUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    });

    render(<MessageLinkPreviews body="https://youtu.be/dQw4w9WgXcQ" token="token" />);

    const frame = await screen.findByTitle("Видео YouTube");
    expect(frame.getAttribute("src")).toContain("enablejsapi=1");
    expect(frame.getAttribute("src")).toContain("playsinline=1");
    expect(screen.getByRole("link", { name: /Открыть на YouTube/u }))
      .toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});
