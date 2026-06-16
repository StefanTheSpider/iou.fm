import BRANDING, { MAKER } from "../branding.js";
import { openExternal } from "../lib/openExternal.js";

// Urheber-Hinweis bleibt immer erhalten (fork and merge UG). Produktname/Tagline
// kommen aus dem (ggf. überschriebenen) Branding.
export default function Footer({ branding = BRANDING }) {
  return (
    <footer className="footer">
      Bereitgestellt mit {branding.productName} · entwickelt von{" "}
      <a href={MAKER.url} rel="noreferrer"
        onClick={(e) => { e.preventDefault(); openExternal(MAKER.url); }}>{MAKER.name}</a>
      {branding.tagline ? ` · ${branding.tagline}` : ""}
    </footer>
  );
}
