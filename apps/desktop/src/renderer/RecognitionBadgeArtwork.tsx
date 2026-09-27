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

export function RecognitionBadgeArtwork({ iconKey }: { readonly iconKey: string }) {
  const artwork = artworkByIconKey[iconKey] ?? starArtwork;
  return <img
    alt=""
    aria-hidden="true"
    className="recognition-badge-artwork"
    data-recognition-icon={iconKey}
    decoding="async"
    draggable={false}
    src={artwork}
  />;
}
