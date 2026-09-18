import { describe, expect, it } from "vitest";

import { extractMessageLinks } from "./MessageLinkPreviews";

describe("message link previews", () => {
  it("extracts unique links and removes sentence punctuation", () => {
    expect(extractMessageLinks("Смотри https://example.com/a, и https://youtu.be/abc12345. https://example.com/a"))
      .toEqual(["https://example.com/a", "https://youtu.be/abc12345"]);
  });

  it("limits one message to three previews", () => {
    expect(extractMessageLinks("https://a.test https://b.test https://c.test https://d.test"))
      .toHaveLength(3);
  });
});
