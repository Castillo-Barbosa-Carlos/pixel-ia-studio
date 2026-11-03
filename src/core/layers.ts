/**
 * Composición de capas y operaciones estructurales sobre capas.
 * Orden: `layers[0]` es la capa inferior; se compone de abajo hacia arriba.
 */
import type { Layer, Matrix, PaletteColor, ProjectDoc, Rect } from '../types/index.ts';
import { TRANSPARENT, LIMITS } from '../types/index.ts';
import { colorToRgba, clamp } from './color.ts';
import { blitMatrix, cloneMatrix, createMatrix, extractRegion, fillRect, shiftIndicesDown } from './matrix.ts';

let layerCounter = 0;

export function nextLayerId(): string {
  layerCounter += 1;
  return `layer-${Date.now().toString(36)}-${layerCounter}`;
}

export function createLayer(width: number, height: number, name: string, fill = TRANSPARENT): Layer {
  return {
    id: nextLayerId(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    matrix: createMatrix(width, height, fill),
  };
}

export function cloneLayer(layer: Layer, withMatrix = true): Layer {
  return {
    ...layer,
    matrix: withMatrix ? cloneMatrix(layer.matrix) : layer.matrix,
  };
}

/** Reemplaza la matriz de una capa concreta devolviendo un doc nuevo. */
export function withLayerMatrix(doc: ProjectDoc, layerId: string, matrix: Matrix): ProjectDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === layerId ? { ...l, matrix } : l)),
  };
}

export function findLayer(doc: ProjectDoc, layerId: string): Layer | undefined {
  return doc.layers.find((l) => l.id === layerId);
}

/**
 * Compone las capas visibles en un buffer RGBA (`width * height * 4`).
 * `override` permite sustituir temporalmente la matriz (y la paleta) de una
 * capa para previsualizar trazos sin confirmar.
 */
export function compositeToRgba(
  doc: ProjectDoc,
  override?: { layerId: string; matrix: Matrix; palette?: PaletteColor[] },
): Uint8ClampedArray {
  const { width, height, layers } = doc;
  const palette = override?.palette ?? doc.palette;
  const out = new Uint8ClampedArray(width * height * 4);

  for (const layer of layers) {
    if (!layer.visible) continue;
    const matrix = override && override.layerId === layer.id ? override.matrix : layer.matrix;
    const layerAlpha = clamp(layer.opacity, 0, 1);
    if (layerAlpha <= 0) continue;

    for (let i = 0; i < matrix.length; i++) {
      const value = matrix[i];
      if (value === TRANSPARENT) continue;
      const color = palette[value];
      if (!color) continue;
      const [r, g, b, a] = colorToRgba(color);
      const srcAlpha = (a / 255) * layerAlpha;
      const o = i * 4;
      if (srcAlpha >= 1) {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      } else if (srcAlpha > 0) {
        const dstAlpha = out[o + 3] / 255;
        const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha);
        if (outAlpha <= 0) continue;
        out[o] = Math.round((r * srcAlpha + out[o] * dstAlpha * (1 - srcAlpha)) / outAlpha);
        out[o + 1] = Math.round((g * srcAlpha + out[o + 1] * dstAlpha * (1 - srcAlpha)) / outAlpha);
        out[o + 2] = Math.round((b * srcAlpha + out[o + 2] * dstAlpha * (1 - srcAlpha)) / outAlpha);
        out[o + 3] = Math.round(outAlpha * 255);
      }
    }
  }
  return out;
}

/** Compone solo una capa (ignora visibilidad y opacidad) en RGBA. */
export function layerToRgba(layer: Layer, palette: PaletteColor[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(layer.matrix.length * 4);
  for (let i = 0; i < layer.matrix.length; i++) {
    const value = layer.matrix[i];
    if (value === TRANSPARENT) continue;
    const color = palette[value];
    if (!color) continue;
    const [r, g, b, a] = colorToRgba(color);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

/** Redimensiona el lienzo preservando el contenido según el anclaje. */
export function resizeDoc(
  doc: ProjectDoc,
  width: number,
  height: number,
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' = 'center',
): ProjectDoc {
  const offsetX = Math.round((width - doc.width) / 2);
  const offsetY = Math.round((height - doc.height) / 2);
  const anchorX = anchor.includes('left') ? 0 : anchor.includes('right') ? width - doc.width : offsetX;
  const anchorY = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? height - doc.height : offsetY;

  const layers = doc.layers.map((layer) => {
    const next = createMatrix(width, height);
    blitMatrix(next, width, height, layer.matrix, doc.width, doc.height, anchorX, anchorY);
    return { ...layer, matrix: next };
  });
  return { ...doc, width, height, layers };
}

/** Fusiona la selección flotante en una capa (los `-1` no pisan el destino). */
export function mergeFloating(
  layer: Layer,
  width: number,
  height: number,
  floating: { x: number; y: number; width: number; height: number; matrix: Matrix },
): Layer {
  const matrix = cloneMatrix(layer.matrix);
  blitMatrix(
    matrix,
    width,
    height,
    floating.matrix,
    floating.width,
    floating.height,
    floating.x,
    floating.y,
  );
  return { ...layer, matrix };
}

/** Extrae una región de una capa como selección flotante. */
export function liftRegion(layer: Layer, width: number, rect: Rect): {
  x: number;
  y: number;
  width: number;
  height: number;
  matrix: Matrix;
  source: { x: number; y: number };
} {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    matrix: extractRegion(layer.matrix, width, rect),
    source: { x: rect.x, y: rect.y },
  };
}

/** Borra una región en una capa (copia de trabajo). */
export function eraseRegion(layer: Layer, width: number, height: number, rect: Rect): Layer {
  const matrix = cloneMatrix(layer.matrix);
  fillRect(matrix, width, height, rect, TRANSPARENT);
  return { ...layer, matrix };
}

/** Elimina un índice de la paleta remapeando todas las matrices. */
export function removePaletteIndex(doc: ProjectDoc, index: number): ProjectDoc {
  return {
    ...doc,
    palette: doc.palette.filter((_, i) => i !== index),
    layers: doc.layers.map((layer) => {
      const matrix = cloneMatrix(layer.matrix);
      shiftIndicesDown(matrix, index);
      return { ...layer, matrix };
    }),
  };
}

export function layerStats(layer: Layer): { painted: number; total: number } {
  let painted = 0;
  for (let i = 0; i < layer.matrix.length; i++) if (layer.matrix[i] !== TRANSPARENT) painted++;
  return { painted, total: layer.matrix.length };
}

export function canAddLayer(doc: ProjectDoc): boolean {
  return doc.layers.length < LIMITS.maxLayers;
}
