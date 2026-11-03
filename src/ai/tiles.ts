/**
 * Generación por bloques (tiling) para lienzos grandes.
 *
 * Un modelo pequeño no puede emitir en una sola respuesta el JSON de un
 * sprite de 32x32 o 64x64: son miles de tokens y la respuesta se trunca o se
 * vacía. La solución es dividir el lienzo en bloques de 16x16 y generar cada
 * bloque con su propia llamada, dándole al modelo los bordes ya generados de
 * los vecinos (izquierda y arriba) para que las costuras casen.
 *
 * El primer bloque fija la paleta; los demás la reutilizan (índices estables).
 */
import type { AiResultPayload, ValidationResult } from '../types/index.ts';
import { TRANSPARENT } from '../types/index.ts';

export const TILE_SIZE = 16;

/** Lienzo a partir del cual se genera por bloques. */
export const TILE_THRESHOLD = 24;

/** Tamaños de bloque disponibles (8 es el más fiable con modelos pequeños). */
export const TILE_SIZES = [8, 12, 16, 24] as const;

export interface TilePlan {
  index: number;
  total: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileContext {
  /** Última columna del bloque de la izquierda (índices de paleta). */
  leftColumn: number[] | null;
  /** Última fila del bloque de arriba (índices de paleta). */
  topRow: number[] | null;
}

export function needsTiling(width: number, height: number): boolean {
  return width > TILE_THRESHOLD || height > TILE_THRESHOLD;
}

export function planTiles(width: number, height: number, tileSize = TILE_SIZE): TilePlan[] {
  const tiles: TilePlan[] = [];
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      tiles.push({
        index: tiles.length,
        total: 0,
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y),
      });
    }
  }
  return tiles.map((t) => ({ ...t, total: tiles.length }));
}

/** Estimación conservadora de tokens de salida para un sprite. */
export function estimateTokens(width: number, height: number, layers = 1): number {
  return Math.round(width * height * 2.6 * layers + width * 9 + 300);
}

/**
 * Contexto de bordes a partir del resultado parcial ya generado.
 * Solo se envían la última columna del vecino izquierdo y la última fila del
 * vecino superior (con `-1` para transparencia) para ahorrar tokens.
 */
export function extractTileContext(
  merged: number[][],
  tile: TilePlan,
): TileContext {
  const leftColumn: number[] | null =
    tile.x > 0
      ? Array.from({ length: tile.height }, (_, i) => merged[tile.y + i]?.[tile.x - 1] ?? TRANSPARENT)
      : null;
  const topRow: number[] | null =
    tile.y > 0
      ? Array.from({ length: tile.width }, (_, i) => merged[tile.y - 1]?.[tile.x + i] ?? TRANSPARENT)
      : null;
  return { leftColumn, topRow };
}

export interface TilePromptOptions {
  description: string;
  tile: TilePlan;
  canvasWidth: number;
  canvasHeight: number;
  palette?: string[];
  context?: TileContext;
  maxLayers?: number;
  /** Plan espacial del sprite completo (fase previa). */
  plan?: string;
  /** Refuerzo para reintentos de bloques planos. */
  reinforce?: boolean;
}

/**
 * Detecta matrices degeneradas: un bloque relleno con un solo color plano es
 * el fallo típico de los modelos pequeños (válido pero inútil).
 */
export function isDegenerateMatrix(matrix: number[][]): boolean {
  const values = new Set<number>();
  let painted = 0;
  let total = 0;
  for (const row of matrix) {
    for (const value of row) {
      total += 1;
      if (value >= 0) {
        painted += 1;
        values.add(value);
      }
    }
  }
  if (total === 0 || painted === 0) return true;
  return values.size < 2 && painted / total > 0.85;
}

/** Prompt de la fase previa: plan espacial del sprite completo. */
export function buildPlanPrompt(description: string, width: number, height: number): string {
  return [
    `Vas a ayudar a dibujar un sprite de pixel art de ${width}x${height} píxeles: ${description.trim() || 'sprite de pixel art'}.`,
    `Antes de dibujarlo, describe en máximo 120 palabras la distribución espacial de la figura: qué forma y colores van en la zona superior izquierda, superior derecha, inferior izquierda, inferior derecha y el centro.`,
    'Responde solo con JSON válido: {"plan": "el texto"}.',
  ].join(' ');
}

/** Prompt para generar un bloque. Incluye `TILE_SIZE=WxH` como marcador. */
export function buildTilePrompt(options: TilePromptOptions): string {
  const { description, tile, canvasWidth, canvasHeight, palette, context, maxLayers = 1, plan, reinforce } = options;
  const parts: string[] = [];
  const isFirst = tile.index === 0;

  if (isFirst) {
    parts.push(
      `Genera el bloque superior izquierdo de un sprite de pixel art de ${canvasWidth}x${canvasHeight} píxeles.`,
    );
    parts.push(`TILE_SIZE=${tile.width}x${tile.height}`);
    parts.push(
      `Devuelve "width": ${tile.width}, "height": ${tile.height}, una paleta de 3 a 12 colores y ${maxLayers} capa(s) con la matriz de ${tile.width}x${tile.height}.`,
    );
  } else {
    parts.push(
      `Genera el bloque en la posición (${tile.x}, ${tile.y}) de un sprite de pixel art de ${canvasWidth}x${canvasHeight} píxeles.`,
    );
    parts.push(`TILE_SIZE=${tile.width}x${tile.height}`);
    parts.push(
      `Devuelve "width": ${tile.width}, "height": ${tile.height} y ${maxLayers} capa(s) con la matriz de ${tile.width}x${tile.height}.`,
    );
    parts.push(`Usa SOLO estos índices de la paleta: ${JSON.stringify(palette ?? [])}.`);
  }

  parts.push(`Descripción del sprite completo: ${description.trim() || 'sprite de pixel art'}.`);
  if (plan) {
    parts.push(`Plan de distribución del sprite completo (síguelo para que los bloques casen): ${plan}`);
  }
  parts.push(`Este bloque representa la zona (${tile.x}, ${tile.y})-(${tile.x + tile.width - 1}, ${tile.y + tile.height - 1}).`);

  const edges: string[] = [];
  if (context?.leftColumn) {
    edges.push(`la última columna del bloque de la izquierda (de arriba abajo): ${JSON.stringify(context.leftColumn)}`);
  }
  if (context?.topRow) {
    edges.push(`la última fila del bloque de arriba (de izquierda a derecha): ${JSON.stringify(context.topRow)}`);
  }
  if (edges.length > 0) {
    parts.push(`Para que las costuras casen, continúa coherentemente estos bordes ya generados (índices de paleta, -1 = transparente): ${edges.join('; ')}.`);
    parts.push('Continúa las formas que tocan esos bordes: no cierres figuras contra ellos ni cambies el color de una silueta a mitad de camino.');
  } else {
    parts.push('Diseña el sprite completo pensando que este bloque es solo una parte: deja las formas abiertas hacia la derecha y hacia abajo.');
  }

  parts.push(
    'Dibuja la parte real de la figura que corresponde a esta zona con varios colores: contornos, rellenos y sombras. ' +
      'NO rellenes el bloque entero con un solo color plano.',
  );
  if (reinforce) {
    parts.push(
      'IMPORTANTE: tu intento anterior salió con un solo color plano. Dibuja ahora la silueta real de la figura en este bloque, usando al menos 3 colores distintos de la paleta.',
    );
  }
  parts.push('Responde solo con el objeto JSON, sin explicaciones.');
  return parts.join(' ');
}

/**
 * Fusiona la matriz de un bloque en el lienzo completo (en sitio).
 * Las matrices de bloque son `number[][]` de `tile.width` x `tile.height`.
 */
export function mergeTileMatrix(
  merged: number[][],
  tile: TilePlan,
  matrix: number[][],
): void {
  for (let y = 0; y < tile.height; y++) {
    const row = matrix[y];
    if (!row) continue;
    for (let x = 0; x < tile.width; x++) {
      const value = row[x];
      if (value === undefined) continue;
      const targetRow = merged[tile.y + y];
      if (!targetRow) continue;
      targetRow[tile.x + x] = value;
    }
  }
}

/** Crea el lienzo completo inicializado en transparencia. */
export function createEmptyGrid(width: number, height: number): number[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => TRANSPARENT));
}

/** Resumen de los bloques generados para la vista previa. */
export function summarizeTiles(results: ValidationResult<AiResultPayload>[]): { ok: number; failed: number } {
  let ok = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}
