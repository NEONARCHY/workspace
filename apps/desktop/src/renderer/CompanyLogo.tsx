import whiteLogo from "./assets/yuksalish-logo-white.png";
import colorLogo from "./assets/yuksalish-logo-color.png";
import { useDocumentColorTheme } from "./color-theme";

/** Original company artwork, bundled locally and never recoloured or cropped. */
export function CompanyLogo({ tone, className = "" }: {
  readonly tone: "white" | "color";
  readonly className?: string;
}) {
  const theme = useDocumentColorTheme();
  return <img className={`company-logo ${className}`} src={tone === "white" || theme === "dark" ? whiteLogo : colorLogo}
    width={3058} height={1010} alt="Yuksalish" draggable={false} />;
}
