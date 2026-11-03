/**
 * Persistencia del proyecto (`.pixelia.json`) con validación estricta.
 * Formato legible: matrices como arrays de filas.
 */
import type { Layer, ProjectDoc, ProjectFile, ValidationResult } from '../types/index.ts';
import { LIMITS, TRANSPARENT } from '../types/index.ts';
import { parseHexColor } from './color.ts';
import { createLayer } from './layers.ts';
import { createMatrix, fromRows, toRows } from './matrix.ts';
import { parsePalette } from './palette.ts';

export const PROJECT_FORMAT = 'pixel-ia-studio';

export function serializeProject(doc: ProjectDoc): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: 1,
    width: doc.width,
    height: doc.height,
    palette: doc.palette.map((c) => (c.alpha >= 255 ? c.hex : `${c.hex}${c.alpha.toString(16).padStart(2, '0')}`)),
    layers: doc.layers.map((layer) => ({
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      matrix: toRows(layer.matrix, doc.width, doc.height),
    })),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function parseProject(text: string): ValidationResult<ProjectDoc> {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['El archivo no contiene JSON válido.'] };
  }
  const doc = validateProjectFile(data, errors);
  if (!doc) return { ok: false, errors };
  return { ok: true, value: doc };
}

export function validateProjectFile(data: unknown, errors: string[] = []): ProjectDoc | null {
  if (typeof data !== 'object' || data === null) {
    errors.push('El proyecto debe ser un objeto JSON.');
    return null;
  }
  const rec = data as Record<string, unknown>;
  if (rec.format !== PROJECT_FORMAT) {
    errors.push(`Formato de proyecto no reconocido (se esperaba "${PROJECT_FORMAT}").`);
    return null;
  }
  const width = rec.width;
  const height = rec.height;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < LIMITS.minSize || width > LIMITS.maxSize) {
    errors.push(`Ancho de lienzo inválido: ${String(width)} (debe ser entero entre ${LIMITS.minSize} y ${LIMITS.maxSize}).`);
    return null;
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || height < LIMITS.minSize || height > LIMITS.maxSize) {
    errors.push(`Alto de lienzo inválido: ${String(height)} (debe ser entero entre ${LIMITS.minSize} y ${LIMITS.maxSize}).`);
    return null;
  }

  let palette = [{ hex: '#000000', alpha: 255 }];
  if (typeof rec.palette === 'string') {
    try {
      palette = parsePalette(rec.palette);
    } catch (e) {
      errors.push((e as Error).message);
      return null;
    }
  } else if (Array.isArray(rec.palette)) {
    const parsed = [];
    for (let i = 0; i < rec.palette.length; i++) {
      const entry = rec.palette[i];
      const color = typeof entry === 'string' ? parseHexColor(entry) : null;
      if (!color) {
        errors.push(`Color de paleta inválido en la posición ${i}: ${JSON.stringify(entry)}.`);
        return null;
      }
      parsed.push(color);
    }
    if (parsed.length === 0) {
      errors.push('La paleta del proyecto está vacía.');
      return null;
    }
    if (parsed.length > LIMITS.maxPalette) {
      errors.push(`La paleta supera el máximo de ${LIMITS.maxPalette} colores.`);
      return null;
    }
    palette = parsed;
  } else {
    errors.push('El proyecto no tiene un campo "palette" válido.');
    return null;
  }

  if (!Array.isArray(rec.layers) || rec.layers.length === 0) {
    errors.push('El proyecto debe incluir al menos una capa.');
    return null;
  }
  if (rec.layers.length > LIMITS.maxLayers) {
    errors.push(`El proyecto supera el máximo de ${LIMITS.maxLayers} capas.`);
    return null;
  }

  const layers: Layer[] = [];
  for (let li = 0; li < rec.layers.length; li++) {
    const entry = rec.layers[li] as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`Capa ${li} inválida.`);
      return null;
    }
    const matrix = entry.matrix;
    if (!Array.isArray(matrix) || matrix.length !== height) {
      errors.push(`La capa ${li} ("${String(entry.name ?? '')}") no tiene ${height} filas.`);
      return null;
    }
    const flat = createMatrix(width, height);
    for (let y = 0; y < height; y++) {
      const row = matrix[y];
      if (!Array.isArray(row) || row.length !== width) {
        errors.push(`La capa ${li} ("${String(entry.name ?? '')}") no tiene ${width} columnas en la fila ${y}.`);
        return null;
      }
      for (let x = 0; x < width; x++) {
        const value = row[x];
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`Valor de píxel inválido en capa ${li}, fila ${y}, columna ${x}.`);
          return null;
        }
        if (value < TRANSPARENT || value >= palette.length) {
          errors.push(`Índice de color ${value} fuera de rango en capa ${li}, fila ${y}, columna ${x} (paleta: ${palette.length}).`);
          return null;
        }
        flat[y * width + x] = value;
      }
    }
    const base = createLayer(width, height, `Capa ${li + 1}`);
    layers.push({
      ...base,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : base.name,
      visible: entry.visible !== false,
      locked: entry.locked === true,
      opacity: typeof entry.opacity === 'number' ? Math.max(0, Math.min(1, entry.opacity)) : 1,
      matrix: flat,
    });
  }

  return { width, height, palette, layers };
}

/** Crea un proyecto vacío. */
export function createEmptyDoc(
  width = 16,
  height = 16,
  palette = [
    { hex: '#000000', alpha: 255 },
    { hex: '#ffffff', alpha: 255 },
    { hex: '#ff00ff', alpha: 255 },
    { hex: '#00ffff', alpha: 255 },
    { hex: '#ffff00', alpha: 255 },
  ],
): ProjectDoc {
  const layer = createLayer(width, height, 'Capa 1');
  return { width, height, palette, layers: [layer] };
}

/** Utilidad para reconstruir matrices en pruebas y ejemplos. */
export function docFromRows(
  palette: string[],
  rows: number[][],
  name = 'base',
): ValidationResult<ProjectDoc> {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return parseProject(
    serializeProject({
      width,
      height,
      palette: palette.map((h) => parseHexColor(h) ?? { hex: '#000000', alpha: 255 }),
      layers: [{ ...createLayer(width, height, name), matrix: fromRows(rows, width, height) }],
    }),
  );
}
