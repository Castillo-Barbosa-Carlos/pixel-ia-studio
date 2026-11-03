/**
 * Primitivas raster para dibujo sobre matrices indexadas.
 * Todas operan sobre una copia de trabajo de la matriz de la capa activa.
 */
import type { Matrix, PaletteColor, Rect } from '../types/index.ts';
import { clamp, lerpColor, nearestColorIndex } from './color.ts';
import { setAt, inBounds } from './matrix.ts';

/** Pincel cuadrado centrado en (cx, cy) de lado `size`. */
export function stampBrush(
  m: Matrix,
  width: number,
  height: number,
  cx: number,
  cy: number,
  value: number,
  size = 1,
): void {
  const half = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      setAt(m, width, height, cx - half + dx, cy - half + dy, value);
    }
  }
}

/** Línea de Bresenham con pincel cuadrado. */
export function drawLine(
  m: Matrix,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
  brushSize = 1,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    stampBrush(m, width, height, x, y, value, brushSize);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Rectángulo relleno o con contorno de grosor `outlineWidth`. */
export function drawRect(
  m: Matrix,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
  filled: boolean,
  outlineWidth = 1,
): void {
  const left = Math.min(Math.round(x0), Math.round(x1));
  const right = Math.max(Math.round(x0), Math.round(x1));
  const top = Math.min(Math.round(y0), Math.round(y1));
  const bottom = Math.max(Math.round(y0), Math.round(y1));
  if (filled) {
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) setAt(m, width, height, x, y, value);
    }
    return;
  }
  const t = Math.max(1, Math.round(outlineWidth));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const onTop = y < top + t;
      const onBottom = y > bottom - t;
      const onLeft = x < left + t;
      const onRight = x > right - t;
      if (onTop || onBottom || onLeft || onRight) setAt(m, width, height, x, y, value);
    }
  }
}

/**
 * Elipse inscrita en el rectángulo (x0,y0)-(x1,y1) usando el algoritmo de
 * punto medio de la ecuación paramétrica (relleno por scanline).
 */
export function drawEllipse(
  m: Matrix,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
  filled: boolean,
  outlineWidth = 1,
): void {
  const left = Math.min(Math.round(x0), Math.round(x1));
  const right = Math.max(Math.round(x0), Math.round(x1));
  const top = Math.min(Math.round(y0), Math.round(y1));
  const bottom = Math.max(Math.round(y0), Math.round(y1));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = (right - left + 1) / 2;
  const ry = (bottom - top + 1) / 2;
  if (rx <= 0 || ry <= 0) {
    setAt(m, width, height, Math.round(cx), Math.round(cy), value);
    return;
  }
  const outerX = rx;
  const outerY = ry;
  const innerX = Math.max(0, rx - outlineWidth);
  const innerY = Math.max(0, ry - outlineWidth);

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const nx = (x - cx) / outerX;
      const ny = (y - cy) / outerY;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      if (filled) {
        setAt(m, width, height, x, y, value);
      } else {
        const ix = (x - cx) / Math.max(innerX, 0.0001);
        const iy = (y - cy) / Math.max(innerY, 0.0001);
        const di = ix * ix + iy * iy;
        if (di >= 1) setAt(m, width, height, x, y, value);
      }
    }
  }
}

/**
 * Degradado lineal entre dos índices de paleta dentro de `rect`.
 * La dirección va del punto `from` al punto `to` (proyección sobre el vector).
 * Los colores intermedios se mapean al índice de paleta más cercano.
 */
export function drawGradient(
  m: Matrix,
  width: number,
  height: number,
  rect: Rect,
  from: { x: number; y: number },
  to: { x: number; y: number },
  indexA: number,
  indexB: number,
  palette: PaletteColor[],
): void {
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const x1 = Math.round(rect.x + rect.w) - 1;
  const y1 = Math.round(rect.y + rect.h) - 1;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lenSq = dx * dx + dy * dy;
  const colorA = palette[indexA];
  const colorB = palette[indexB];
  if (!colorA || !colorB) return;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let t: number;
      if (lenSq <= 0.0001) {
        t = 0;
      } else {
        t = ((x - from.x) * dx + (y - from.y) * dy) / lenSq;
        t = clamp(t, 0, 1);
      }
      const mixed = lerpColor(colorA, colorB, t);
      const [r, g, b] = [
        parseInt(mixed.hex.slice(1, 3), 16),
        parseInt(mixed.hex.slice(3, 5), 16),
        parseInt(mixed.hex.slice(5, 7), 16),
      ];
      setAt(m, width, height, x, y, nearestColorIndex(r, g, b, palette));
    }
  }
}

/**
 * Calcula el color sombreado de una celda y devuelve el índice de paleta
 * resultante. `extendPalette` permite añadir el color calculado a la paleta
 * cuando ningún color existente está cerca (decisión documentada).
 * Devuelve el índice usado y si la paleta fue ampliada.
 */
export function computeShadeIndex(
  cellValue: number,
  palette: PaletteColor[],
  direction: 'lighten' | 'darken',
  strength: number,
  extendPalette: boolean,
): { index: number; newColor?: PaletteColor } {
  const base = cellValue < 0 ? { hex: '#000000', alpha: 255 } : palette[cellValue];
  if (!base) return { index: cellValue };
  const amount = direction === 'lighten' ? strength : -strength;
  const [r, g, b] = [
    parseInt(base.hex.slice(1, 3), 16),
    parseInt(base.hex.slice(3, 5), 16),
    parseInt(base.hex.slice(5, 7), 16),
  ];
  const t = clamp(amount, -1, 1);
  const target = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const shaded: PaletteColor = {
    hex: `#${[r + (target - r) * k, g + (target - g) * k, b + (target - b) * k]
      .map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0'))
      .join('')}`,
    alpha: base.alpha,
  };
  const nearest = nearestColorIndex(
    parseInt(shaded.hex.slice(1, 3), 16),
    parseInt(shaded.hex.slice(3, 5), 16),
    parseInt(shaded.hex.slice(5, 7), 16),
    palette,
  );
  const [nr, ng, nb] = [
    parseInt(palette[nearest].hex.slice(1, 3), 16),
    parseInt(palette[nearest].hex.slice(3, 5), 16),
    parseInt(palette[nearest].hex.slice(5, 7), 16),
  ];
  const dist = Math.abs(nr - r) + Math.abs(ng - g) + Math.abs(nb - b);
  if (dist <= 12 || !extendPalette) return { index: nearest };
  return { index: palette.length, newColor: shaded };
}

/**
 * Relleno por área comparando el color RGB de la paleta con una tolerancia
 * euclidiana (0 = coincidencia exacta de índice).
 */
export function floodFillTolerant(
  m: Matrix,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
  palette: PaletteColor[],
  tolerance = 0,
): boolean {
  if (!inBounds(x, y, width, height)) return false;
  const target = m[y * width + x];
  if (target === value) return false;
  const targetColor = palette[target];
  if (!targetColor) return false;

  const matches = (cell: number): boolean => {
    if (cell === target) return true;
    if (tolerance <= 0) return false;
    const color = palette[cell];
    if (!color) return false;
    const [tr, tg, tb] = [
      parseInt(targetColor.hex.slice(1, 3), 16),
      parseInt(targetColor.hex.slice(3, 5), 16),
      parseInt(targetColor.hex.slice(5, 7), 16),
    ];
    const [r, g, b] = [
      parseInt(color.hex.slice(1, 3), 16),
      parseInt(color.hex.slice(3, 5), 16),
      parseInt(color.hex.slice(5, 7), 16),
    ];
    const dist = Math.sqrt((tr - r) ** 2 + (tg - g) ** 2 + (tb - b) ** 2);
    return dist <= tolerance * 4;
  };

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

/** Normaliza un rectángulo definido por dos puntos de arrastre. */
export function rectFromPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  square = false,
): Rect {
  let ax = x1;
  let ay = y1;
  if (square) {
    const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    ax = x0 + Math.sign(x1 - x0 || 1) * side;
    ay = y0 + Math.sign(y1 - y0 || 1) * side;
  }
  const x = Math.min(x0, ax);
  const y = Math.min(y0, ay);
  return { x, y, w: Math.abs(ax - x0) + 1, h: Math.abs(ay - y0) + 1 };
}
