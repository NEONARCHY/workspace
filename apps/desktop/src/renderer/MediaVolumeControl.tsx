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
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
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
        onClick={() => setOpen((current) => !current)}
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
            onChange={(event) => changeVolume(Number(event.currentTarget.value) / 100)}
          />
          <output aria-hidden="true">{Math.round(volume * 100)}%</output>
        </div>
      ) : null}
    </div>
  );
}
