/**
 * Paletas de color: utilidades, importación y exportación.
 * Formatos soportados:
 *  - JSON: ["#rrggbb", ...] o { "colors": ["#rrggbb", ...] } o [{hex, alpha}]
 *  - HEX: una línea por color (`#rrggbb`)
 *  - GPL: paleta de GIMP ("GIMP Palette")
 */
import type { PaletteColor } from '../types/index.ts';
import { LIMITS } from '../types/index.ts';
import { colorToHexAlpha, colorsEqual, parseHexColor, rgbaToHex } from './color.ts';

export type PaletteFormat = 'json' | 'hex' | 'gpl';

export function detectPaletteFormat(text: string): PaletteFormat {
  const head = text.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  if (/^GIMP Palette/i.test(head)) return 'gpl';
  return 'hex';
}

/** Analiza una paleta en cualquier formato soportado. Lanza `Error` con mensaje claro. */
export function parsePalette(text: string, format?: PaletteFormat): PaletteColor[] {
  const kind = format ?? detectPaletteFormat(text);
  if (kind === 'json') return parsePaletteJson(text);
  if (kind === 'gpl') return parsePaletteGpl(text);
  return parsePaletteHex(text);
}

function parsePaletteJson(text: string): PaletteColor[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El contenido JSON de la paleta no es válido.');
  }
  const list = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null && Array.isArray((data as { colors?: unknown }).colors)
      ? ((data as { colors: unknown[] }).colors)
      : null;
  if (!list) throw new Error('La paleta JSON debe ser un array de colores o un objeto con "colors".');
  const colors: PaletteColor[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      const color = parseHexColor(item);
      if (!color) throw new Error(`Color no válido en la paleta: "${item}".`);
      colors.push(color);
    } else if (typeof item === 'object' && item !== null) {
      const rec = item as { hex?: unknown; alpha?: unknown };
      if (typeof rec.hex !== 'string') throw new Error('Entrada de paleta JSON sin campo "hex".');
      const color = parseHexColor(rec.hex);
      if (!color) throw new Error(`Color no válido en la paleta: "${String(rec.hex)}".`);
      if (typeof rec.alpha === 'number') color.alpha = Math.max(0, Math.min(255, Math.round(rec.alpha)));
      colors.push(color);
    } else {
      throw new Error('Entrada de paleta JSON no reconocida.');
    }
  }
  return checkPalette(colors);
}

function parsePaletteHex(text: string): PaletteColor[] {
  const colors: PaletteColor[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const token = line.split(/\s+/)[0];
    const color = parseHexColor(token);
    if (!color) throw new Error(`Línea HEX no válida: "${line}".`);
    colors.push(color);
  }
  return checkPalette(colors);
}

function parsePaletteGpl(text: string): PaletteColor[] {
  const colors: PaletteColor[] = [];
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette/i.test(lines[0]?.trim() ?? '')) {
    throw new Error('El archivo GPL debe comenzar con "GIMP Palette".');
  }
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || /^(Name|Columns|Author|Copyright):/i.test(line)) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/);
    if (!match) throw new Error(`Línea GPL no válida: "${line}".`);
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if ([r, g, b].some((v) => v < 0 || v > 255)) throw new Error(`Valores RGB fuera de rango: "${line}".`);
    colors.push({ hex: rgbaToHex(r, g, b), alpha: 255 });
  }
  return checkPalette(colors);
}

function checkPalette(colors: PaletteColor[]): PaletteColor[] {
  if (colors.length === 0) throw new Error('La paleta no contiene colores.');
  if (colors.length > LIMITS.maxPalette) {
    throw new Error(`La paleta supera el máximo de ${LIMITS.maxPalette} colores.`);
  }
  return colors;
}

/* ---------------------------- exportación ---------------------------- */

export function serializePaletteJson(palette: PaletteColor[]): string {
  return `${JSON.stringify(palette.map((c) => colorToHexAlpha(c)), null, 2)}\n`;
}

export function serializePaletteHex(palette: PaletteColor[]): string {
  return `${palette.map((c) => colorToHexAlpha(c)).join('\n')}\n`;
}

export function serializePaletteGpl(palette: PaletteColor[], name = 'Pixel-IA Studio'): string {
  const lines = ['GIMP Palette', `Name: ${name}`, `Columns: ${Math.min(16, palette.length)}`, '#'];
  palette.forEach((c, i) => {
    const r = parseInt(c.hex.slice(1, 3), 16);
    const g = parseInt(c.hex.slice(3, 5), 16);
    const b = parseInt(c.hex.slice(5, 7), 16);
    lines.push(`${String(r).padStart(3, ' ')}${String(g).padStart(4, ' ')}${String(b).padStart(4, ' ')}\tColor ${i}`);
  });
  return `${lines.join('\n')}\n`;
}

/* ---------------------------- operaciones ---------------------------- */

export function addColor(palette: PaletteColor[], color: PaletteColor): PaletteColor[] {
  if (palette.length >= LIMITS.maxPalette) return palette;
  return [...palette, color];
}

export function updateColor(
  palette: PaletteColor[],
  index: number,
  color: PaletteColor,
): PaletteColor[] {
  return palette.map((c, i) => (i === index ? color : c));
}

/** Índice del primer color igual, o -1. */
export function findColorIndex(palette: PaletteColor[], color: PaletteColor): number {
  return palette.findIndex((c) => colorsEqual(c, color));
}

/** Asegura que un color exista en la paleta; devuelve índice y paleta posible extendida. */
export function ensureColor(
  palette: PaletteColor[],
  color: PaletteColor,
): { palette: PaletteColor[]; index: number } {
  const existing = findColorIndex(palette, color);
  if (existing >= 0) return { palette, index: existing };
  const next = addColor(palette, color);
  return { palette: next, index: next.length - 1 };
}
