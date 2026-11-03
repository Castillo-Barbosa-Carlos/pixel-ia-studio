/**
 * Algoritmo de Generación Jerárquica y Reescalado Piramidal para lienzos grandes (>= 64px).
 *
 * En lugar de trocear el sprite en bloques ortogonales independientes (que destruye
 * la anatomía y genera costuras visibles), este algoritmo:
 *  1. Calcula un tamaño base proporcional reducido (<= 32x32) donde la IA comprende
 *     la figura de forma holística y sin cortes de tokens.
 *  2. Genera la composición base (concepto, proporciones, silueta y paleta unificada).
 *  3. Reescala algorítmicamente la matriz base al tamaño destino con vecino más próximo (nearest-neighbor).
 *  4. Aplica suavizado de bordes (anti-aliasing de pixel art) preservando la paleta.
 */
import { scaleRows } from '../core/matrix.ts';
import { TRANSPARENT } from '../types/index.ts';

/** Umbral a partir del cual se activa la generación por reescalado piramidal */
export const RESCALE_THRESHOLD = 64;

export function needsRescaling(width: number, height: number): boolean {
  return width >= RESCALE_THRESHOLD || height >= RESCALE_THRESHOLD;
}

export interface BaseSizeInfo {
  baseW: number;
  baseH: number;
  scaleFactor: number;
}

/**
 * Calcula las dimensiones óptimas de baja resolución manteniendo la relación de aspecto.
 */
export function computeBaseSize(targetW: number, targetH: number): BaseSizeInfo {
  const maxDim = Math.max(targetW, targetH);
  if (maxDim <= 32) return { baseW: targetW, baseH: targetH, scaleFactor: 1 };
  const scaleFactor = Math.max(2, Math.ceil(maxDim / 32));
  const baseW = Math.max(16, Math.min(32, Math.round(targetW / scaleFactor)));
  const baseH = Math.max(16, Math.min(32, Math.round(targetH / scaleFactor)));
  return { baseW, baseH, scaleFactor };
}

/**
 * Convierte un array de strings (grid ASCII) a matriz numérica, o escala una matriz de filas.
 */
export function upscaleRows(
  rows: number[][],
  baseW: number,
  baseH: number,
  targetW: number,
  targetH: number,
): number[][] {
  return scaleRows(rows, baseW, baseH, targetW, targetH);
}

/**
 * Suavizador de bordes escalonados para pixel art (Corner Anti-Aliasing).
 * Suaviza las aristas en bloque creadas por el reescalado cuando hay diagonales.
 */
export function smoothPixelArtEdges(
  rows: number[][],
  width: number,
  height: number,
  paletteSize: number,
): { matrix: number[][]; smoothedCount: number } {
  const out = rows.map((r) => [...r]);
  let smoothedCount = 0;

  // Solo suavizar si hay una paleta con al menos 2 colores
  if (paletteSize < 2 || width <= 2 || height <= 2) {
    return { matrix: out, smoothedCount: 0 };
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const current = rows[y][x];

      // Detección de escalones diagonales:
      // Si la celda actual es transparente pero dos vecinos ortogonales adyacentes
      // comparten el mismo color, se puede suavizar la esquina si no sobreescribe masa.
      if (current === TRANSPARENT) {
        const top = rows[y - 1][x];
        const bottom = rows[y + 1][x];
        const left = rows[y][x - 1];
        const right = rows[y][x + 1];

        // Esquina superior-izquierda interna
        if (top >= 0 && left >= 0 && top === left && bottom === TRANSPARENT && right === TRANSPARENT) {
          // Suavizado opcional de esquina
          out[y][x] = top;
          smoothedCount++;
        } else if (top >= 0 && right >= 0 && top === right && bottom === TRANSPARENT && left === TRANSPARENT) {
          out[y][x] = top;
          smoothedCount++;
        } else if (bottom >= 0 && left >= 0 && bottom === left && top === TRANSPARENT && right === TRANSPARENT) {
          out[y][x] = bottom;
          smoothedCount++;
        } else if (bottom >= 0 && right >= 0 && bottom === right && top === TRANSPARENT && left === TRANSPARENT) {
          out[y][x] = bottom;
          smoothedCount++;
        }
      }
    }
  }

  return { matrix: out, smoothedCount };
}
