const MODULE = "party-book";

export const PRESETS = {
  parchment: { label: "Old Parchment", paper: "radial-gradient(ellipse at 50% 40%,#f3e2b8 0%,#e4c98f 62%,#b88b4a 100%)", ink: "#3a2812", accent: "#7b1e12", border: "#6b4a22", veil: "40,24,8", overlay: 0.35, grain: 0.35 },
  "dnd-classic": { label: "D&D Classic Sheet", paper: "linear-gradient(#f7f1e2,#efe4cb)", ink: "#231a10", accent: "#58180d", border: "#9c8352", veil: "246,240,225", overlay: 0.45, grain: 0.12 },
  "old-letter": { label: "Aged Letter (found document)", paper: "radial-gradient(circle at 18% 12%,#ead9ab,transparent 42%),radial-gradient(circle at 88% 92%,rgba(150,100,45,.55),transparent 48%),#d8bf8a", ink: "#2b1d0c", accent: "#5a1a10", border: "#5e4220", veil: "60,40,15", overlay: 0.3, grain: 0.55 },
  "dark-dungeon": { label: "Dark Dungeon", paper: "linear-gradient(160deg,#262221,#141212)", ink: "#d8d0c0", accent: "#c39a3a", border: "#4b3f33", veil: "0,0,0", overlay: 0.55, grain: 0.25 },
  "blood-iron": { label: "Blood & Iron", paper: "linear-gradient(160deg,#2c1010,#120606)", ink: "#ecd9d2", accent: "#d04a38", border: "#5a1c1c", veil: "20,0,0", overlay: 0.55, grain: 0.25 },
  arcane: { label: "Arcane Grimoire", paper: "linear-gradient(160deg,#181b37,#0b0d1f)", ink: "#d5dcff", accent: "#8ea0ff", border: "#3a4180", veil: "5,5,30", overlay: 0.55, grain: 0.2 },
  necrotic: { label: "Necrotic Crypt", paper: "linear-gradient(160deg,#1c2420,#0b0f0d)", ink: "#c9e0d2", accent: "#6fe3a0", border: "#2f4a3d", veil: "0,10,5", overlay: 0.55, grain: 0.25 },
  elven: { label: "Elven Leaf", paper: "linear-gradient(160deg,#eaf0d7,#cfdcb0)", ink: "#223319", accent: "#3f7a3a", border: "#6f8a4a", veil: "230,240,205", overlay: 0.4, grain: 0.15 }
};

export function getPresets() {
  let custom = {};
  try { custom = JSON.parse(game.settings.get(MODULE, "customPresets") || "{}"); } catch (e) { console.warn("Party Book | invalid custom presets JSON", e); }
  const out = { ...PRESETS };
  for (const [id, p] of Object.entries(custom)) out[id] = { ...PRESETS.parchment, label: id, ...p };
  return out;
}

export const clean = v => String(v ?? "").replace(/[;"<>{}\\]/g, "").trim();
export const urlSafe = v => String(v ?? "").replace(/["\\\n\r]/g, c => encodeURIComponent(c));

/** Build the inline CSS-variable string for a page. */
export function styleVars(id, o = {}) {
  const all = getPresets();
  const p = all[id] ?? all.parchment;
  const hasBg = !!o.bg;
  const overlay = o.overlay === "" || o.overlay == null ? p.overlay : Number(o.overlay);
  const font = clean(o.font).replace(/[^\w\s-]/g, "");
  const parts = [
    `--pb-paper:${clean(o.paper) || p.paper}`,
    `--pb-ink:${clean(o.ink) || p.ink}`,
    `--pb-accent:${clean(o.accent) || p.accent}`,
    `--pb-border:${p.border}`,
    `--pb-grain:${p.grain}`,
    `--pb-veil:rgba(${p.veil},${overlay})`
  ];
  if (hasBg) parts.push(`--pb-bgimg:url("${urlSafe(o.bg)}")`);
  if (font) parts.push(`--pb-font:"${font}",serif`);
  if (o.size) parts.push(`--pb-size:${Math.min(Math.max(Number(o.size) || 17, 10), 40)}px`);
  if (["left", "center", "right", "justify"].includes(o.align)) parts.push(`--pb-align:${o.align}`);
  return { style: parts.join(";"), hasBg };
}
