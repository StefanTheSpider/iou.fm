// Theme-Engine für White-Label: Hell/Dunkel-Modus + frei wählbare Farben
// (Primär, Sekundär, Text) als HEX oder RGB. Setzt CSS-Variablen am :root.

const DARK = {
  bg: "#0a0c0f", surface: "#13161c", raised: "#1b1f27", "raised-2": "#232935",
  border: "#242a33", "border-strong": "#333b47",
  text: "#e9ecf2", muted: "#8b94a3", faint: "#5b6473",
  amber: "#e7b15a", "amber-bg": "#2a2012", red: "#ff6f6f", "red-bg": "#2c1518",
  green: "#3ddc97", "green-bg": "#0f2a20",
  shadow: "0 10px 34px rgba(0,0,0,0.4)", "topbar-bg": "rgba(15,18,23,0.82)",
};
const LIGHT = {
  bg: "#f4f6fa", surface: "#ffffff", raised: "#eef1f6", "raised-2": "#e6ebf2",
  border: "#e4e9f0", "border-strong": "#cdd5e0",
  text: "#161922", muted: "#5c6675", faint: "#9aa3b1",
  amber: "#a96f12", "amber-bg": "#f7eed7", red: "#cf3a34", "red-bg": "#fae8e7",
  green: "#1c9b61", "green-bg": "#e1f5ea",
  shadow: "0 8px 24px rgba(20,30,50,0.08)", "topbar-bg": "rgba(255,255,255,0.82)",
};

// Akzeptiert "#rgb", "#rrggbb", "rgb(r,g,b)", "rgba(r,g,b,a)".
export function parseColor(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
  m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return null;
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = ({ r, g, b }) => "#" + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, "0")).join("");

// Normalisiert beliebige Eingabe zu einem CSS-tauglichen Hex (oder null).
export function normalizeColor(str) {
  const c = parseColor(str);
  return c ? toHex(c) : null;
}

export function shade(str, f) {
  const c = parseColor(str);
  if (!c) return str;
  return toHex({ r: c.r * f, g: c.g * f, b: c.b * f });
}

export function contrastInk(str) {
  const c = parseColor(str);
  if (!c) return "#04261a";
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  return lum > 0.58 ? "#04261a" : "#ffffff";
}

export function applyTheme(theme = {}) {
  const mode = theme.mode === "light" ? "light" : "dark";
  const base = mode === "light" ? LIGHT : DARK;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(base)) root.style.setProperty("--" + k, v);

  const primary = normalizeColor(theme.primary) || theme.primary || "#3ddc97";
  const secondary = normalizeColor(theme.secondary) || theme.secondary || (mode === "light" ? "#3257d6" : "#5b8cff");
  root.style.setProperty("--accent", primary);
  root.style.setProperty("--accent-press", shade(primary, 0.86));
  root.style.setProperty("--accent-ink", contrastInk(primary));
  root.style.setProperty("--secondary", secondary);
  const text = normalizeColor(theme.text);
  if (text) root.style.setProperty("--text", text);
  root.style.setProperty("color-scheme", mode);
}
