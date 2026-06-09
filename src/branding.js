// White-Label über EINE Codebasis:
//  - DEFAULT = generisch (neutraler Auslieferungszustand für jeden Kunden)
//  - PRESETS = benannte Marken-Voreinstellungen (Build-Zeit), z. B. "tixtravel"
//  - Auswahl per Build-Variable VITE_BRAND (z. B. `VITE_BRAND=tixtravel npm run build`)
//  - Zur Laufzeit überschreibt der Kunde Name/Logo/Theme unter Stammdaten → Darstellung
//
// So bleibt Tix & Travel beliebig individualisierbar, ohne die Massentauglichkeit
// zu verlieren – jeder andere Kunde startet weiterhin neutral.
//
// Der Urheber-Hinweis (MAKER) bleibt immer erhalten und ist nicht überschreibbar.

export const MAKER = { name: "fork and merge UG", url: "https://www.fork-and-merge.com/" };

const DEFAULT = {
  productName: "iou.fm",
  brandText: "iou",
  brandAccent: ".fm",
  logoUrl: "/iou-logo-gold.png",
  tagline: "IBAN · Order · Überweisung",
  theme: { mode: "dark", primary: "#3ddc97", secondary: "#5b8cff", text: "" },
};

// Marken-Presets. Nur nicht-geheime Werte (Name/Logo/Farben/Defaults) –
// Konten, Tokens usw. bleiben Laufzeit-Konfiguration im Tresor.
const PRESETS = {
  tixtravel: {
    productName: "Tix & Travel · Zahlungen",
    brandText: "Tix &",
    brandAccent: "Travel",
    logoUrl: "", // Tix nutzt die Wortmarke, nicht das iou.fm-Logo
    tagline: "intern · alle Daten lokal & verschlüsselt",
    theme: { mode: "dark", primary: "#3ddc97", secondary: "#5b8cff", text: "" },
  },
};

const active = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BRAND) || "";
const preset = PRESETS[active] || {};

const BRANDING = {
  ...DEFAULT, ...preset,
  theme: { ...DEFAULT.theme, ...(preset.theme || {}) },
};

export default BRANDING;
