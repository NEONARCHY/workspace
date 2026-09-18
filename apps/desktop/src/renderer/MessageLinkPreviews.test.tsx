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

  it("renders Instagram as an external card instead of a blocked iframe", async () => {
    vi.mocked(loadLinkPreview).mockResolvedValue({
      url: "https://www.instagram.com/reels/example/",
      canonicalUrl: "https://www.instagram.com/reels/example/",
      kind: "instagram",
      title: "Публикация Instagram",
      description: "",
      siteName: "Instagram",
      imageUrl: null,
      embedUrl: null,
    });

    render(<MessageLinkPreviews body="https://www.instagram.com/reels/example/" token="token" />);

    const card = await screen.findByRole("link", { name: "Открыть в Instagram: Публикация Instagram" });
    expect(card).toHaveAttribute("href", "https://www.instagram.com/reels/example/");
    expect(card.querySelector("iframe")).toBeNull();
  });
});
