import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecognitionBadgeArtwork } from "./RecognitionBadgeArtwork";

const iconKeys = [
  "appreciation",
  "camera",
  "check",
  "compass",
  "gem",
  "innovation",
  "layers",
  "leadership",
  "mail",
  "megaphone",
  "mentorship",
  "orbit",
  "pulse",
  "receipt",
  "reliability",
  "rescue",
  "signal",
  "spark",
  "target",
] as const;

afterEach(cleanup);

describe("RecognitionBadgeArtwork", () => {
  it("renders a three-dimensional image for every achievement and reward type", () => {
    const { container } = render(<>{iconKeys.map((iconKey) => (
      <RecognitionBadgeArtwork key={iconKey} iconKey={iconKey} />
    ))}</>);

    const artwork = Array.from(container.querySelectorAll<HTMLImageElement>(".recognition-badge-artwork"));
    expect(artwork).toHaveLength(iconKeys.length);
    expect(artwork.map((image) => image.dataset.recognitionIcon)).toEqual(iconKeys);
    expect(artwork.every((image) => image.src.endsWith(".png"))).toBe(true);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("uses a three-dimensional fallback for future achievement types", () => {
    const { container } = render(<RecognitionBadgeArtwork iconKey="future-achievement" />);
    const artwork = container.querySelector<HTMLImageElement>(".recognition-badge-artwork");
    expect(artwork).toHaveAttribute("data-recognition-icon", "future-achievement");
    expect(artwork?.src).toContain("star");
  });
});
