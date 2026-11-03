/**
 * Utilidades de canvas: construcción de `ImageData` compatible con buffers
 * tipados (evita problemas de tipos `Uint8ClampedArray` en TS 5.7+).
 */
export function toImageData(rgba: Uint8ClampedArray, width: number, height: number): ImageData {
  const image = new ImageData(width, height);
  image.data.set(rgba);
  return image;
}
