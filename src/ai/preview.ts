/**
 * Conversión de un resultado de IA (paleta + matrices) en píxeles RGBA
 * para la vista previa del panel.
 */
import type { AiResultPayload } from '../types/index.ts';
import { TRANSPARENT } from '../types/index.ts';
import { parseHexColor } from '../core/color.ts';
import { toImageData } from '../utils/canvas.ts';

export function aiResultToRgba(result: AiResultPayload): Uint8ClampedArray {
  const { width, height } = result;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const palette = result.palette.map((hex) => parseHexColor(hex) ?? { hex: '#000000', alpha: 255 });

  for (const layer of result.layers) {
    for (let y = 0; y < height; y++) {
      const row = layer.matrix[y];
      if (!row) continue;
      for (let x = 0; x < width; x++) {
        const value = row[x];
        if (value === TRANSPARENT) continue;
        const color = palette[value];
        if (!color) continue;
        const o = (y * width + x) * 4;
        rgba[o] = parseInt(color.hex.slice(1, 3), 16);
        rgba[o + 1] = parseInt(color.hex.slice(3, 5), 16);
        rgba[o + 2] = parseInt(color.hex.slice(5, 7), 16);
        rgba[o + 3] = color.alpha;
      }
    }
  }
  return rgba;
}

/** Dibuja el resultado de la IA en un canvas con damero de fondo. */
export function drawAiPreview(canvas: HTMLCanvasElement, result: AiResultPayload, scale: number): void {
  const { width, height } = result;
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  // Damero
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#3a3a42' : '#2c2c33';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  offCtx.putImageData(toImageData(aiResultToRgba(result), width, height), 0, 0);
  ctx.drawImage(off, 0, 0, width * scale, height * scale);
}
