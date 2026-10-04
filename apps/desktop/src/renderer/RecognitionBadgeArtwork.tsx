import bulbArtwork from "./assets/recognition/bulb.png";
import chartArtwork from "./assets/recognition/chart.png";
import chatArtwork from "./assets/recognition/chat.png";
import crownArtwork from "./assets/recognition/crown.png";
import cubeArtwork from "./assets/recognition/cube.png";
import fileArtwork from "./assets/recognition/file-text.png";
import flashArtwork from "./assets/recognition/flash.png";
import heartArtwork from "./assets/recognition/heart.png";
import mailArtwork from "./assets/recognition/mail.png";
import mapPinArtwork from "./assets/recognition/map-pin.png";
import medalArtwork from "./assets/recognition/medal.png";
import megaphoneArtwork from "./assets/recognition/megaphone.png";
import notebookArtwork from "./assets/recognition/notebook.png";
import shieldArtwork from "./assets/recognition/sheild.png";
import sphereArtwork from "./assets/recognition/sphere.png";
import starArtwork from "./assets/recognition/star.png";
import targetArtwork from "./assets/recognition/target.png";
import videoCameraArtwork from "./assets/recognition/video-camera.png";
import { scheduleProfileWork } from "./profile-idle";

const artworkByIconKey: Readonly<Record<string, string>> = {
  appreciation: heartArtwork,
  camera: videoCameraArtwork,
  check: targetArtwork,
  compass: mapPinArtwork,
  gem: medalArtwork,
  innovation: bulbArtwork,
  initiative: starArtwork,
  layers: cubeArtwork,
  leadership: crownArtwork,
  mail: mailArtwork,
  mastery: medalArtwork,
  megaphone: megaphoneArtwork,
  mentorship: notebookArtwork,
  orbit: sphereArtwork,
  pulse: chartArtwork,
  receipt: fileArtwork,
  reliability: shieldArtwork,
  rescue: flashArtwork,
  signal: chatArtwork,
  spark: heartArtwork,
  target: targetArtwork,
  teamwork: chatArtwork,
};

const decoded = new Map<string, Promise<void>>();
export function prewarmRecognitionArtwork(iconKeys: readonly string[]): () => void {
  const sources = [...new Set(iconKeys.map((key) => artworkByIconKey[key] ?? starArtwork))].filter((source) => !decoded.has(source));
  let stopped = false;
  let cancel = () => undefined as void;
  const next = () => {
    if (stopped || document.visibilityState === "hidden") return;
    const source = sources.shift();
    if (!source) return;
    cancel = scheduleProfileWork(() => {
      let pending = decoded.get(source);
      if (!pending) {
        const image = new Image();
        image.src = source;
        pending = typeof image.decode === "function" ? image.decode() : Promise.resolve();
        pending = pending.catch(() => { decoded.delete(source); });
        decoded.set(source, pending);
      }
      void pending.then(next);
    });
  };
  next();
  return () => { stopped = true; cancel(); };
}

export function RecognitionBadgeArtwork({ iconKey }: { readonly iconKey: string }) {
  const artwork = artworkByIconKey[iconKey] ?? starArtwork;
  return <img
    alt=""
    aria-hidden="true"
    className="recognition-badge-artwork"
    data-recognition-icon={iconKey}
    decoding="async"
    loading="lazy"
    draggable={false}
    src={artwork}
  />;
}
