import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@fluentui/react-components";
import { Speaker224Regular, SpeakerMute24Regular } from "@fluentui/react-icons";

interface MediaVolumeControlProps {
  readonly mediaRef: RefObject<HTMLMediaElement | null>;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function MediaVolumeControl({ mediaRef, disabled = false, className = "" }: MediaVolumeControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const open = !disabled && (pinnedOpen || hoverOpen);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPinnedOpen(false);
        setHoverOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const changeVolume = (nextVolume: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = nextVolume;
    media.muted = nextVolume === 0;
    setVolume(nextVolume);
  };

  return (
    <div
      ref={rootRef}
      className={`media-volume-control${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      onPointerEnter={(event) => {
        if (!disabled && event.pointerType !== "touch") setHoverOpen(true);
      }}
      onPointerLeave={(event) => {
        setHoverOpen(false);
        const focused = document.activeElement;
        if (focused && event.currentTarget.contains(focused)
          && focused.closest(".media-volume-popover")) setPinnedOpen(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPinnedOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setPinnedOpen(false);
          setHoverOpen(false);
          rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      <Button
        className="media-volume-trigger"
        appearance="subtle"
        icon={volume === 0 ? <SpeakerMute24Regular /> : <Speaker224Regular />}
        aria-label="Громкость"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setPinnedOpen((current) => !current)}
      />
      {open ? (
        <div className="media-volume-popover">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(volume * 100)}
            aria-label="Уровень громкости"
            aria-orientation="vertical"
            onChange={(event) => changeVolume(Number(event.currentTarget.value) / 100)}
          />
          <output aria-hidden="true">{Math.round(volume * 100)}%</output>
        </div>
      ) : null}
    </div>
  );
}
