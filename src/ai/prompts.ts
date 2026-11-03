/**
 * Construcción de los prompts para los modelos locales.
 * Se exige JSON puro (sin Markdown) para facilitar el parseo.
 */
import type { AiMode, Rect } from '../types/index.ts';
import { LIMITS } from '../types/index.ts';

export const SYSTEM_PROMPT = [
  'Eres un generador de pixel art que responde ÚNICAMENTE con JSON válido.',
  'No escribas explicaciones, comentarios, ni fences de Markdown.',
  'El JSON debe cumplir exactamente este esquema:',
  '{"width":<entero>,"height":<entero>,"palette":["#rrggbb",...],"layers":[{"name":"<texto>","visible":true,"grid":["<string>",...]}]}',
  'Reglas del grid ASCII: cada fila es un string de exactamente "width" caracteres (o "matrix":[[<entero>,...],...]);',
  'el carácter "." o el número -1 representa transparencia;',
  'los caracteres "0", "1", "2"... o enteros >=0 representan los índices de la paleta (0-based);',
  'el grid debe tener exactamente "height" filas.',
  'Escribe las matrices en formato compacto, sin espacios innecesarios: [[0,1,-1],[2,3,4]] o ["..00",".010"].',
  `La paleta debe tener entre 2 y ${LIMITS.maxPalette} colores HEX en formato "#rrggbb".`,
  `El lienzo debe ser como máximo ${LIMITS.maxSize}x${LIMITS.maxSize}.`,
].join(' ');

const MODE_HINTS: Record<AiMode, string> = {
  palette:
    'Genera SOLO una paleta de color coherente para la descripción. Devuelve {"palette":[...]}; width/height/layers son opcionales y pueden omitirse.',
  matrix:
    'Genera SOLO las matrices de píxeles (capas) usando los colores de la paleta indicada. Devuelve {"width","height","layers":[...]}; la paleta es opcional.',
  full:
    'Genera la paleta y el grid ASCII o matrices de píxeles (una o varias capas) del sprite completo.',
  pipeline:
    'Generación en pipeline multi-etapa: diseño progresivo de paleta, silueta y detalles con grid ASCII.',
  inpaint:
    'Inpainting / Modificación local: Genera únicamente la submatriz o grid de la región seleccionada, integrándola limpiamente con el contexto circundante.',
};

export interface PromptOptions {
  mode: AiMode;
  description: string;
  width: number;
  height: number;
  /** Paleta de referencia cuando el modo usa una paleta existente. */
  palette?: string[];
  maxLayers?: number;
}

export function buildUserPrompt(options: PromptOptions): string {
  const { mode, description, width, height, palette, maxLayers = 3 } = options;
  const parts: string[] = [
    MODE_HINTS[mode],
    `Descripción del sprite: ${description.trim() || 'sprite de pixel art'}.`,
  ];
  if (mode !== 'palette') {
    parts.push(`Tamaño exacto del lienzo: ${width}x${height} píxeles.`);
    parts.push(`Usa como máximo ${maxLayers} capas con nombres descriptivos en español.`);
    parts.push(
      'Formato de capa recomendado: usa "grid" con un array de strings (ej. [".00.", ".11."]) donde "." es transparente (-1) y "0", "1", "2"... son los índices de paleta; o "matrix" numérico.',
    );
  } else if (width > 0 && height > 0) {
    parts.push(`Pensado para un lienzo de ${width}x${height} píxeles.`);
  }
  if (palette && palette.length > 0 && (mode === 'matrix' || mode === 'full')) {
    parts.push(`Paleta obligatoria (usa solo estos índices): ${JSON.stringify(palette)}.`);
  }
  parts.push('Responde solo con el objeto JSON.');
  return parts.join(' ');
}

/** Prompt de Etapa 1: Paleta temática y concepto visual */
export function buildPipelineStage1Prompt(description: string): string {
  return [
    `Genera una paleta de 4 a 8 colores HEX contrastados y armoniosos para este sprite: ${description.trim() || 'pixel art'}.`,
    'Define un concepto visual conciso (1 frase).',
    'Responde ÚNICAMENTE con JSON en este formato exacto:',
    '{"concept": "<frase concisa>", "palette": ["#rrggbb", ...]}',
  ].join(' ');
}

/** Prompt de Etapa 2: Silueta y estructura base (grid binario) */
export function buildPipelineStage2Prompt(
  description: string,
  width: number,
  height: number,
  palette: string[],
  concept?: string,
): string {
  return [
    `Etapa 2 (Silueta base): Diseña la silueta, proporción y masa del sprite ${description.trim() || 'pixel art'} de ${width}x${height} píxeles.`,
    concept ? `Concepto visual: ${concept}.` : '',
    `Paleta disponible: ${JSON.stringify(palette)}.`,
    `Devuelve un "grid" ASCII de exactamente ${height} filas de exactamente ${width} caracteres:`,
    '- Usa "." para fondo transparente.',
    '- Usa "0" para la silueta/contorno principal de la figura.',
    '- Usa "1" para el relleno interior base.',
    'Responde solo con JSON:',
    `{"width": ${width}, "height": ${height}, "layers": [{"name": "silueta", "grid": ["...", ...]}]}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Prompt de Etapa 3: Sombreado, luces y acabado profesional */
export function buildPipelineStage3Prompt(
  description: string,
  width: number,
  height: number,
  palette: string[],
  baseGrid: string[],
): string {
  return [
    `Etapa 3 (Detalles y sombreado): Transforma la silueta previa en un sprite final detallado de ${width}x${height} píxeles para: ${description.trim() || 'pixel art'}.`,
    `Paleta obligatoria (usa todos los índices necesarios 0, 1, 2...): ${JSON.stringify(palette)}.`,
    `Silueta base previa de referencia:\n${JSON.stringify(baseGrid)}`,
    'Instrucciones de acabado:',
    '- Conserva la silueta y masa de la figura previa.',
    '- Añade luces en la zona superior/izquierda y sombras en la inferior/derecha.',
    '- Sustituye los caracteres por los índices de la paleta ("0", "1", "2", "3"...) para dar profundidad visual.',
    '- Mantén "." para la transparencia.',
    'Responde solo con JSON:',
    `{"width": ${width}, "height": ${height}, "palette": ${JSON.stringify(palette)}, "layers": [{"name": "sprite final", "grid": ["...", ...]}]}`,
  ].join(' ');
}

export interface InpaintPromptOptions {
  description: string;
  selection: Rect;
  canvasWidth: number;
  canvasHeight: number;
  palette: string[];
  currentGrid?: string[];
  contextTop?: string;
  contextBottom?: string;
  contextLeft?: string;
  contextRight?: string;
}

/** Prompt para Inpainting (modificación de una región seleccionada del lienzo) */
export function buildInpaintPrompt(options: InpaintPromptOptions): string {
  const {
    description,
    selection,
    canvasWidth,
    canvasHeight,
    palette,
    currentGrid,
    contextTop,
    contextBottom,
    contextLeft,
    contextRight,
  } = options;

  const parts: string[] = [
    `Tarea de Inpainting (edición de región seleccionada):`,
    `Estás modificando un área rectangular de ${selection.w}x${selection.h} píxeles ubicada en la posición x=${selection.x}, y=${selection.y} dentro de un sprite de ${canvasWidth}x${canvasHeight} píxeles.`,
    `Descripción de la modificación deseada: "${description.trim() || 'modificar y mejorar esta región'}".`,
    `Paleta obligatoria del proyecto: ${JSON.stringify(palette)}.`,
    `Debes devolver ÚNICAMENTE una matriz o grid de tamaño EXACTO ${selection.w}x${selection.h} píxeles (${selection.h} filas de ${selection.w} caracteres).`,
  ];

  if (currentGrid && currentGrid.length > 0) {
    parts.push(`Contenido actual en la región seleccionada:\n${JSON.stringify(currentGrid)}`);
  }

  const contexts: string[] = [];
  if (contextTop) contexts.push(`Borde superior vecino: "${contextTop}"`);
  if (contextBottom) contexts.push(`Borde inferior vecino: "${contextBottom}"`);
  if (contextLeft) contexts.push(`Borde izquierdo vecino: "${contextLeft}"`);
  if (contextRight) contexts.push(`Borde derecho vecino: "${contextRight}"`);
  if (contexts.length > 0) {
    parts.push(`Contexto de bordes adyacentes para que la integración sea perfecta:\n${contexts.join('; ')}.`);
  }

  parts.push(
    'Usa "." para transparencia y dígitos "0", "1", "2"... para los colores de la paleta.',
    `Responde ÚNICAMENTE con JSON en este formato exacto: {"width": ${selection.w}, "height": ${selection.h}, "layers": [{"name": "inpaint", "grid": ["...", ...]}]}`,
  );

  return parts.join(' ');
}

/** Prompt de Refinamiento para sprites grandes generados por reescalado */
export function buildRescaleRefinementPrompt(
  description: string,
  width: number,
  height: number,
  palette: string[],
  upscaledGrid: string[],
): string {
  return [
    `Pase de Refinamiento y Detallado de Alta Resolución (${width}x${height} píxeles) para: "${description.trim()}".`,
    `Paleta del sprite: ${JSON.stringify(palette)}.`,
    `A continuación tienes la base anatómica y compositiva escalada proporcionalmente al tamaño ${width}x${height}:\n${JSON.stringify(upscaledGrid)}`,
    'Instrucciones de refinamiento:',
    '- Suaviza las líneas escaladas y elimina el efecto bloque/escalón (anti-aliasing de pixel art).',
    '- Añade detalles de alta resolución: texturas, brillo en ojos/metales y sombreado degradado.',
    '- Conserva rigurosamente la postura, proporción y masa de la figura.',
    'Responde ÚNICAMENTE con JSON:',
    `{"width": ${width}, "height": ${height}, "palette": ${JSON.stringify(palette)}, "layers": [{"name": "sprite refinado", "grid": ["...", ...]}]}`,
  ].join(' ');
}
