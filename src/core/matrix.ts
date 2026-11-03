/**
 * Operaciones sobre matrices de píxeles indexadas (`Int16Array`).
 * Todas las funciones que "dibujan" devuelven una matriz nueva o mutan una
 * copia de trabajo; las matrices confirmadas en el historial nunca se mutan.
 */
import type { Matrix, Rect } from '../types/index.ts';
import { TRANSPARENT } from '../types/index.ts';
import { clamp } from './color.ts';

export function createMatrix(width: number, height: number, fill: number = TRANSPARENT): Matrix {
  const m = new Int16Array(width * height);
  if (fill !== TRANSPARENT) m.fill(fill);
  else m.fill(TRANSPARENT);
  return m;
}

export function cloneMatrix(m: Matrix): Matrix {
  return new Int16Array(m);
}

export function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function getAt(m: Matrix, width: number, height: number, x: number, y: number): number {
  if (!inBounds(x, y, width, height)) return TRANSPARENT;
  return m[y * width + x];
}

export function setAt(
  m: Matrix,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
): void {
  if (!inBounds(x, y, width, height)) return;
  m[y * width + x] = value;
}

/** Rellena un rectángulo con un valor. */
export function fillRect(
  m: Matrix,
  width: number,
  height: number,
  rect: Rect,
  value: number,
): void {
  const x0 = clamp(Math.floor(rect.x), 0, width);
  const y0 = clamp(Math.floor(rect.y), 0, height);
  const x1 = clamp(Math.ceil(rect.x + rect.w), 0, width);
  const y1 = clamp(Math.ceil(rect.y + rect.h), 0, height);
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) m[row + x] = value;
  }
}

/**
 * Relleno por área (flood fill) 4-conectado sobre celdas con el mismo valor.
 * Devuelve true si algo cambió. Tolera valores fuera de rango en `tolerance`
 * comparando contra el color de referencia (ver `fillAreaByColor`).
 */
export function floodFill(
  m: Matrix,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
  tolerance = 0,
  reference?: (cell: number) => number,
): boolean {
  if (!inBounds(x, y, width, height)) return false;
  const target = m[y * width + x];
  if (target === value) return false;

  const key = reference ?? ((cell: number) => cell);
  const refKey = key(target);
  const matches = (cell: number) =>
    tolerance <= 0 ? cell === target : Math.abs(key(cell) - refKey) <= tolerance;

  if (!matches(target)) return false;

  const stack: number[] = [y * width + x];
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    if (m[idx] === value) continue;
    if (!matches(m[idx])) continue;
    m[idx] = value;
    const cx = idx % width;
    const cy = (idx / width) | 0;
    if (cx > 0) stack.push(idx - 1);
    if (cx < width - 1) stack.push(idx + 1);
    if (cy > 0) stack.push(idx - width);
    if (cy < height - 1) stack.push(idx + width);
  }
  return true;
}

/** Reemplaza todas las celdas con índice `from` por `to`. */
export function replaceColor(m: Matrix, from: number, to: number): boolean {
  let changed = false;
  for (let i = 0; i < m.length; i++) {
    if (m[i] === from) {
      m[i] = to;
      changed = true;
    }
  }
  return changed;
}

/** Traslada índices > `removed` una posición hacia abajo (al borrar un color). */
export function shiftIndicesDown(m: Matrix, removed: number): void {
  for (let i = 0; i < m.length; i++) {
    if (m[i] === removed) m[i] = TRANSPARENT;
    else if (m[i] > removed) m[i] -= 1;
  }
}

/** Copia `src` sobre `dst` en la posición (dx, dy). `-1` puede ser ignorado. */
export function blitMatrix(
  dst: Matrix,
  dstWidth: number,
  dstHeight: number,
  src: Matrix,
  srcWidth: number,
  srcHeight: number,
  dx: number,
  dy: number,
  skipTransparent = true,
): void {
  for (let y = 0; y < srcHeight; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstHeight) continue;
    for (let x = 0; x < srcWidth; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstWidth) continue;
      const value = src[y * srcWidth + x];
      if (skipTransparent && value === TRANSPARENT) continue;
      dst[ty * dstWidth + tx] = value;
    }
  }
}

export function extractRegion(
  m: Matrix,
  width: number,
  rect: Rect,
  fill: number = TRANSPARENT,
): Matrix {
  const out = createMatrix(rect.w, rect.h, fill);
  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y;
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      if (sx < 0 || sy < 0 || sy * width + sx >= m.length || sx >= width) continue;
      out[y * rect.w + x] = m[sy * width + sx];
    }
  }
  return out;
}

export function clearRegion(m: Matrix, width: number, height: number, rect: Rect): void {
  fillRect(m, width, height, rect, TRANSPARENT);
}

export function matrixEquals(a: Matrix, b: Matrix): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Serializa a filas de arrays (JSON legible). */
export function toRows(m: Matrix, width: number, height: number): number[][] {
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = new Array(width);
    for (let x = 0; x < width; x++) row[x] = m[y * width + x];
    rows.push(row);
  }
  return rows;
}

/** Reconstruye una matriz desde filas validando dimensiones. */
export function fromRows(rows: number[][], width: number, height: number): Matrix {
  const m = createMatrix(width, height);
  for (let y = 0; y < height && y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < width && x < row.length; x++) m[y * width + x] = row[x];
  }
  return m;
}

/** Cuenta celdas no transparentes (para diagnóstico y estado). */
export function countPainted(m: Matrix): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) if (m[i] !== TRANSPARENT) n++;
  return n;
}

/**
 * Reescala una matriz de píxeles al tamaño de destino mediante vecino más próximo (nearest neighbor).
 * Preserva nítidamente el arte pixelado sin borrosidad.
 */
export function scaleMatrix(
  src: Matrix,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Matrix {
  const dst = createMatrix(dstW, dstH);
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return dst;
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor((dy * srcH) / dstH));
    const dstRow = dy * dstW;
    const srcRow = sy * srcW;
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx * srcW) / dstW));
      dst[dstRow + dx] = src[srcRow + sx];
    }
  }
  return dst;
}

/**
 * Reescala una matriz de filas (number[][]) al tamaño de destino.
 */
export function scaleRows(
  rows: number[][],
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): number[][] {
  const out: number[][] = [];
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0 || rows.length === 0) return out;
  for (let dy = 0; dy < dstH; dy++) {
    const sy = Math.min(srcH - 1, Math.floor((dy * srcH) / dstH));
    const sourceRow = rows[sy] ?? [];
    const newRow = new Array<number>(dstW);
    for (let dx = 0; dx < dstW; dx++) {
      const sx = Math.min(srcW - 1, Math.floor((dx * srcW) / dstW));
      newRow[dx] = sourceRow[sx] ?? TRANSPARENT;
    }
    out.push(newRow);
  }
  return out;
}
