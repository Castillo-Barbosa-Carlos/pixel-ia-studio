/**
 * Tipos centrales de Pixel-IA Studio.
 *
 * Convenciones del documento:
 * - La matriz de cada capa es un `Int16Array` de largo `width * height` en orden
 *   fila-major (índice = y * width + x).
 * - Cada celda contiene `-1` (transparencia) o un índice dentro de la paleta.
 * - El orden de capas es de abajo hacia arriba: `layers[0] es la capa inferior`.
 */

export type Matrix = Int16Array;

/** Color de paleta: hex `#rrggbb` en minúsculas + alfa 0..255. */
export interface PaletteColor {
  hex: string;
  alpha: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Opacidad 0..1 aplicada al componer la capa. */
  opacity: number;
  matrix: Matrix;
}

export interface ProjectDoc {
  width: number;
  height: number;
  palette: PaletteColor[];
  layers: Layer[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Selección flotante (resultado de pegar o de mover una selección). */
export interface FloatingSelection {
  x: number;
  y: number;
  width: number;
  height: number;
  matrix: Matrix;
  /** Posición original al levantar la región (para cancelar el movimiento). */
  source: { x: number; y: number } | null;
}

export interface ClipboardData {
  width: number;
  height: number;
  matrix: Matrix;
}

export type ToolId =
  | 'pencil'
  | 'pencil-eraser'
  | 'eraser'
  | 'eyedropper'
  | 'fill'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'gradient'
  | 'shade'
  | 'select';

export interface ToolOptions {
  /** Tamaño del pincel en píxeles (1..16). */
  brushSize: number;
  /** Figuras rellenas (true) o solo contorno (false). */
  shapeFilled: boolean;
  /** Grosor del contorno en píxeles cuando `shapeFilled` es false. */
  outlineWidth: number;
  /** Fuerza del sombreado (0.05..0.5). */
  shadeStrength: number;
  /** Tolerancia del relleno por área (0 = mismo color exacto). */
  fillTolerance: number;
}

export type ShadeDirection = 'lighten' | 'darken';

/* ------------------------------------------------------------------ */
/* IA                                                                  */
/* ------------------------------------------------------------------ */

export type AiProvider = 'ollama' | 'openai';

export interface AiSettings {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  timeoutMs: number;
  /** Límite de tokens de salida (`num_predict` en Ollama, `max_tokens` en OpenAI). */
  maxTokens: number;
  /** Tamaño de bloque en píxeles para la generación de lienzos grandes. */
  tileSize: number;
  /**
   * Control del modo de razonamiento ("think") en Ollama.
   * `off` acelera y estabiliza la generación de JSON en modelos tipo Qwen3.
   */
  reasoning: 'auto' | 'off' | 'on';
}

/** Generación solicitada al modelo. */
export type AiMode = 'palette' | 'matrix' | 'full' | 'pipeline' | 'inpaint';

export interface AiLayerPayload {
  name: string;
  visible: boolean;
  matrix: number[][];
  grid?: string[];
}

/** Formato de respuesta esperado de la IA (ver docs/AI-JSON-FORMAT.md). */
export interface AiResultPayload {
  width: number;
  height: number;
  palette: string[];
  layers: AiLayerPayload[];
}

export type AiStatus = 'idle' | 'connecting' | 'generating' | 'ok' | 'error';

/** Progreso de una generación en curso (streaming). */
export interface AiProgress {
  elapsedMs: number;
  chars: number;
  /** Etapa opcional (p. ej. "Bloque 3/9" en generación por bloques). */
  stage?: string;
}

export interface AiPreview {
  result: AiResultPayload;
  /** Modo con el que se generó: determina qué se puede aplicar. */
  mode: AiMode;
  prompt: string;
  raw: string;
  /**
   * true cuando la paleta devuelta por la IA no era válida y se sustituyó por
   * la paleta actual del proyecto.
   */
  paletteFallback: boolean;
  /** Región asociada al inpainting (si el modo fue 'inpaint'). */
  selectionRect?: Rect;
}

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

export interface ProjectFile {
  format: 'pixel-ia-studio';
  version: 1;
  width: number;
  height: number;
  palette: string[];
  layers: Array<{
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    matrix: number[][];
  }>;
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export const TRANSPARENT = -1;

export const LIMITS = {
  minSize: 1,
  maxSize: 256,
  maxLayers: 32,
  maxPalette: 256,
  historyLimit: 60,
  maxBrushSize: 16,
} as const;
