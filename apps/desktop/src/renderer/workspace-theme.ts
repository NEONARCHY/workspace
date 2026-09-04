import { createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

// brand_identity.pdf, p.4: turquoise #0091A8 and navy #293A55.
// Intermediate shades are UI states, never replacements for logo artwork.
export const workspaceBrand: BrandVariants = {
  10: "#061D22", 20: "#0A3139", 30: "#094653", 40: "#075869",
  50: "#006779", 60: "#00788A", 70: "#008397", 80: "#0091A8",
  90: "#26A0B4", 100: "#4AB0C0", 110: "#6ABFCD", 120: "#8ACED8",
  130: "#ABDEE5", 140: "#C7E9EE", 150: "#E0F2F5", 160: "#F2FAFB",
};
export const workspaceFont = '"Gilroy", "Segoe UI", sans-serif';
export const workspaceTheme: Theme = {
  ...createLightTheme(workspaceBrand),
  fontFamilyBase: workspaceFont,
  fontFamilyNumeric: workspaceFont,
  colorNeutralForeground1: "#293A55",
  colorNeutralForeground2: "#4C6074",
  colorNeutralForeground3: "#596C7F",
  colorNeutralForeground4: "#596C7F",
  colorBrandBackground: "#293A55",
  colorBrandBackgroundHover: "#203149",
  colorBrandBackgroundPressed: "#142238",
  colorBrandBackgroundSelected: "#203149",
  colorBrandForeground1: "#006779",
  colorBrandForeground2: "#006779",
  colorBrandForegroundLink: "#006779",
  colorBrandForegroundLinkHover: "#075869",
  colorBrandForegroundLinkPressed: "#094653",
  colorBrandBackground2: "#E0F2F5",
  colorNeutralBackground1: "#FFFFFF",
  colorNeutralBackground2: "#F5F8FA",
  colorNeutralStroke1: "#CAD5DD",
  colorNeutralStroke2: "#DFE7ED",
  borderRadiusSmall: "6px",
  borderRadiusMedium: "10px",
  borderRadiusLarge: "16px",
  borderRadiusXLarge: "20px",
};
