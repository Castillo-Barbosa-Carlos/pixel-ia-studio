/**
 * Utilidades de color para paletas indexadas.
 * Todos los hex se normalizan a `#rrggbb` en minúsculas.
 */
import type { PaletteColor } from '../types/index.ts';

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

/** Acepta `#rgb`, `#rrggbb`, `#rrggbbaa` (con o sin `#`). */
export function parseHexColor(input: string): PaletteColor | null {
  const raw = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  let hex: string;
  let alpha = 255;
  if (raw.length === 3) {
    hex = raw
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (raw.length === 6) {
    hex = raw;
  } else if (raw.length === 8) {
    hex = raw.slice(0, 6);
    alpha = parseInt(raw.slice(6, 8), 16);
  } else {
    return null;
  }
  return { hex: `#${hex.toLowerCase()}`, alpha };
}

export function isHexColor(input: string): boolean {
  return parseHexColor(input) !== null;
}

export function colorToHex(color: PaletteColor): string {
  return color.hex;
}

export function colorToHexAlpha(color: PaletteColor): string {
  return color.alpha >= 255 ? color.hex : `${color.hex}${hex2(color.alpha)}`;
}

function hex2(n: number): string {
  return clampInt(n, 0, 255).toString(16).padStart(2, '0');
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export function rgbaToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r = clamp(r, 0, 255) / 255;
  g = clamp(g, 0, 255) / 255;
  b = clamp(b, 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(v * 100)];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  const sNorm = clamp(s, 0, 100) / 100;
  const vNorm = clamp(v, 0, 100) / 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = vNorm * (1 - sNorm);
  const q = vNorm * (1 - f * sNorm);
  const t = vNorm * (1 - (1 - f) * sNorm);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0: r = vNorm; g = t; b = p; break;
    case 1: r = q; g = vNorm; b = p; break;
    case 2: r = p; g = vNorm; b = t; break;
    case 3: r = p; g = q; b = vNorm; break;
    case 4: r = t; g = p; b = vNorm; break;
    case 5: r = vNorm; g = p; b = q; break;
  }
  return [clampInt(r * 255, 0, 255), clampInt(g * 255, 0, 255), clampInt(b * 255, 0, 255)];
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbaToHex(r, g, b);
}

export function colorToRgba(color: PaletteColor): [number, number, number, number] {
  const [r, g, b] = hexToRgb(color.hex);
  return [r, g, b, color.alpha];
}

export function rgbaToColor(r: number, g: number, b: number, a = 255): PaletteColor {
  return { hex: rgbaToHex(r, g, b), alpha: clampInt(a, 0, 255) };
}

export function colorToCss(color: PaletteColor): string {
  const [r, g, b, a] = colorToRgba(color);
  return a >= 255 ? `#${color.hex.slice(1)}` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** Estilo CSS rgba() (para canvas y swatches). */
export function colorToCssRgba(color: PaletteColor): string {
  const [r, g, b, a] = colorToRgba(color);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

export function distanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

/** Índice del color de paleta más cercano a un RGB dado (compara en RGB plano). */
export function nearestColorIndex(
  r: number,
  g: number,
  b: number,
  palette: PaletteColor[],
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = hexToRgb(palette[i].hex);
    const d = distanceSq(r, g, b, pr, pg, pb);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Aclara (amount > 0) u oscurece (amount < 0) un color.
 * `amount` está en -1..1 y se aplica sobre el canal de luminosidad.
 */
export function shadeColor(color: PaletteColor, amount: number): PaletteColor {
  const [r, g, b] = hexToRgb(color.hex);
  const t = clamp(amount, -1, 1);
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  return {
    hex: rgbaToHex(
      Math.round(r + (target - r) * k),
      Math.round(g + (target - g) * k),
      Math.round(b + (target - b) * k),
    ),
    alpha: color.alpha,
  };
}

/** Interpola linealmente entre dos colores (t en 0..1). */
export function lerpColor(a: PaletteColor, b: PaletteColor, t: number): PaletteColor {
  const [ar, ag, ab] = hexToRgb(a.hex);
  const [br, bg, bb] = hexToRgb(b.hex);
  const k = clamp(t, 0, 1);
  return {
    hex: rgbaToHex(
      Math.round(ar + (br - ar) * k),
      Math.round(ag + (bg - ag) * k),
      Math.round(ab + (bb - ab) * k),
    ),
    alpha: Math.round(a.alpha + (b.alpha - a.alpha) * k),
  };
}

export function colorsEqual(a: PaletteColor, b: PaletteColor): boolean {
  return a.hex === b.hex && a.alpha === b.alpha;
}

/** Brillo percibido 0..255 (útil para decidir el color del texto sobre un swatch). */
export function luminance(color: PaletteColor): number {
  const [r, g, b] = hexToRgb(color.hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
