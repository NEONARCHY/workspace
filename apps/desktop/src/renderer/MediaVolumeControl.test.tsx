import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MediaVolumeControl } from "./MediaVolumeControl";

afterEach(cleanup);

function PlayerHarness() {
  const mediaRef = useRef<HTMLVideoElement>(null);
  return <><video ref={mediaRef} /><MediaVolumeControl mediaRef={mediaRef} /></>;
}

describe("MediaVolumeControl", () => {
  it("opens its slider and changes the media element volume", () => {
    render(<PlayerHarness />);

    const trigger = screen.getByRole("button", { name: "Громкость" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);

    const slider = screen.getByRole("slider", { name: "Уровень громкости" });
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    fireEvent.change(slider, { target: { value: "35" } });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("video")?.volume).toBe(.35);
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  it("mutes at zero and closes with Escape", () => {
    render(<PlayerHarness />);
    const trigger = screen.getByRole("button", { name: "Громкость" });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("slider", { name: "Уровень громкости" }), { target: { value: "0" } });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Уровень громкости" }), { key: "Escape" });

    expect(document.querySelector("video")?.muted).toBe(true);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
