/**
 * Validación estricta del JSON devuelto por la IA.
 *
 * La IA debe entregar:
 *   { width, height, palette: string[], layers: [{ name, visible, matrix: number[][] }] }
 *
 * Cualquier desviación produce errores legibles por campo; nunca se aplica un
 * resultado inválido al documento.
 */
import type { AiMode, AiResultPayload, ValidationResult } from '../types/index.ts';
import { LIMITS, TRANSPARENT } from '../types/index.ts';
import { colorToHexAlpha, parseHexColor, rgbaToColor } from '../core/color.ts';

const MAX_CELLS = LIMITS.maxSize * LIMITS.maxSize;

/**
 * Extrae el primer objeto JSON válido de la respuesta cruda de un modelo.
 * Tolera vallas de código Markdown y texto de relleno (aunque el prompt exige
 * JSON puro, algunos modelos pequeños lo ignoran).
 */
export function extractJson(raw: string): ValidationResult<unknown> {
  const text = raw.trim();
  if (!text) return { ok: false, errors: ['La respuesta de la IA está vacía.'] };

  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  candidates.push(text);

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (e) {
      errors.push(`JSON no parseable: ${(e as Error).message}`);
    }
  }
  return {
    ok: false,
    errors: [
      'La respuesta de la IA no contiene un objeto JSON válido.',
      ...errors.slice(0, 2),
    ],
  };
}

/**
 * Coerción de formatos habituales de color que devuelven los modelos.
 * Acepta: "#rgb", "#rrggbb", "#rrggbbaa", [r,g,b], [r,g,b,a] y {r,g,b,a}.
 * Devuelve `null` si el valor no es interpretable de forma inequívoca
 * (p. ej. un número suelto, que podría ser un índice de paleta).
 */
export function coercePaletteEntry(entry: unknown): string | null {
  if (typeof entry === 'string') {
    const color = parseHexColor(entry);
    return color ? colorToHexAlpha(color) : null;
  }
  const fromRgb = (r: unknown, g: unknown, b: unknown, a: unknown = 255): string | null => {
    const values = [r, g, b, a];
    if (!values.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255)) return null;
    return colorToHexAlpha(rgbaToColor(r as number, g as number, b as number, a as number));
  };
  if (Array.isArray(entry)) {
    if (entry.length === 3 || entry.length === 4) return fromRgb(entry[0], entry[1], entry[2], entry[3] ?? 255);
    return null;
  }
  if (typeof entry === 'object' && entry !== null) {
    const rec = entry as Record<string, unknown>;
    if ('r' in rec || 'red' in rec) {
      return fromRgb(rec.r ?? rec.red, rec.g ?? rec.green, rec.b ?? rec.blue, rec.a ?? rec.alpha ?? 255);
    }
  }
  return null;
}

/**
 * Convierte un grid de cadenas ASCII a una matriz numérica de índices.
 * Reconoce:
 *   '.' / '-' / '_' / ' ' => -1 (transparencia)
 *   '0'..'9' => 0..9
 *   'A'..'Z' => 10..35
 *   'a'..'z' => 10..35
 * O utiliza el mapeo provisto en 'chars' / 'charMap' si existe.
 */
export function gridRowsToMatrix(
  rows: unknown[],
  charsMap?: Record<string, number>,
): number[][] {
  return rows.map((row) => {
    if (Array.isArray(row)) {
      return row.map((v) => (typeof v === 'number' && Number.isInteger(v) ? v : TRANSPARENT));
    }
    const rowStr = String(row ?? '');
    if (/,|\s{2,}/.test(rowStr.trim())) {
      const parts = rowStr.trim().split(/[\s,]+/);
      return parts.map((p) => {
        if (p === '.' || p === '-1' || p === '-') return TRANSPARENT;
        const n = Number(p);
        return Number.isInteger(n) ? n : TRANSPARENT;
      });
    }
    return Array.from(rowStr).map((ch) => {
      if (charsMap && ch in charsMap) return charsMap[ch];
      if (ch === '.' || ch === '-' || ch === '_' || ch === ' ') return TRANSPARENT;
      if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
      if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 65 + 10;
      if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 97 + 10;
      return TRANSPARENT;
    });
  });
}

/**
 * Esquema JSON estricto para salidas estructuradas en Ollama y OpenAI.
 */
export function getStrictJsonSchema(
  mode: AiMode,
  width: number,
  height: number,
): Record<string, unknown> {
  if (mode === 'palette') {
    return {
      type: 'object',
      properties: {
        palette: {
          type: 'array',
          items: { type: 'string' },
          minItems: 2,
          maxItems: 32,
        },
      },
      required: ['palette'],
    };
  }

  const layerItem = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      grid: {
        type: 'array',
        items: { type: 'string' },
        description: `${height} filas de exactamente ${width} caracteres`,
      },
    },
    required: ['name'],
  };

  if (mode === 'matrix' || mode === 'inpaint') {
    return {
      type: 'object',
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
        layers: {
          type: 'array',
          items: layerItem,
          minItems: 1,
        },
      },
      required: ['width', 'height', 'layers'],
    };
  }

  return {
    type: 'object',
    properties: {
      width: { type: 'integer' },
      height: { type: 'integer' },
      palette: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 32,
      },
      layers: {
        type: 'array',
        items: layerItem,
        minItems: 1,
      },
    },
    required: ['width', 'height', 'palette', 'layers'],
  };
}

/** Valida el payload de la IA con un esquema estricto. */
export function validateAiResult(
  data: unknown,
  mode: AiMode = 'full',
  knownPaletteSize?: number,
): ValidationResult<AiResultPayload> {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Se esperaba un objeto JSON con width, height, palette y layers.'] };
  }
  const rec = data as Record<string, unknown>;

  /* ---------------- dimensiones ---------------- */
  let width = rec.width;
  let height = rec.height;
  const needMatrix = mode === 'matrix' || mode === 'full' || mode === 'inpaint';
  const needPalette = mode === 'palette' || mode === 'full';

  if (mode === 'palette') {
    // Solo paleta: las dimensiones son opcionales.
    if (width === undefined) width = 0;
    if (height === undefined) height = 0;
  }
  if (typeof width !== 'number' || !Number.isInteger(width) || (width !== 0 && (width < LIMITS.minSize || width > LIMITS.maxSize))) {
    errors.push(`"width" debe ser un entero entre ${LIMITS.minSize} y ${LIMITS.maxSize} (recibido: ${JSON.stringify(rec.width)}).`);
  }
  if (typeof height !== 'number' || !Number.isInteger(height) || (height !== 0 && (height < LIMITS.minSize || height > LIMITS.maxSize))) {
    errors.push(`"height" debe ser un entero entre ${LIMITS.minSize} y ${LIMITS.maxSize} (recibido: ${JSON.stringify(rec.height)}).`);
  }

  /* ---------------- paleta ---------------- */
  let palette: string[] = [];
  if (needPalette || rec.palette !== undefined) {
    const badEntries: string[] = [];
    if (!Array.isArray(rec.palette) || rec.palette.length === 0) {
      if (needPalette) errors.push('"palette" debe ser un array no vacío de colores HEX.');
    } else {
      if (rec.palette.length > LIMITS.maxPalette) {
        errors.push(`"palette" supera el máximo de ${LIMITS.maxPalette} colores.`);
      }
      for (let i = 0; i < rec.palette.length; i++) {
        const entry = rec.palette[i];
        const hex = coercePaletteEntry(entry);
        if (!hex) {
          if (badEntries.length < 4) {
            badEntries.push(`palette[${i}]=${JSON.stringify(entry)}`);
          } else if (badEntries.length === 4) {
            badEntries.push('…');
          }
          continue;
        }
        palette.push(hex);
      }
      if (badEntries.length > 0 && needPalette) {
        errors.push(
          `"palette" contiene ${rec.palette.length - palette.length} color(es) inválido(s): ${badEntries.join(', ')}. ` +
            'Se espera "#rrggbb" (también se aceptan [r,g,b] y {r,g,b}).',
        );
      }
    }
    if (needPalette && palette.length === 0 && errors.length === 0) {
      errors.push('No se recibió ningún color de paleta válido.');
    }
    // En modo "matrix" la paleta es opcional: si no es válida se ignora y se
    // usará la paleta del proyecto al aplicar.
    if (!needPalette && palette.length === 0) palette = [];
  }

  /* ---------------- capas ---------------- */
  const layers: AiResultPayload['layers'] = [];
  if (needMatrix) {
    if (!Array.isArray(rec.layers) || rec.layers.length === 0) {
      errors.push('"layers" debe ser un array con al menos una capa.');
    } else {
      if (rec.layers.length > LIMITS.maxLayers) {
        errors.push(`"layers" supera el máximo de ${LIMITS.maxLayers} capas.`);
      }
      const w = width as number;
      const h = height as number;
      for (let li = 0; li < rec.layers.length; li++) {
        const entry = rec.layers[li] as Record<string, unknown>;
        if (typeof entry !== 'object' || entry === null) {
          errors.push(`"layers[${li}]" debe ser un objeto.`);
          continue;
        }
        const charsMap = (rec.chars ?? rec.charMap ?? entry.chars ?? entry.charMap) as Record<string, number> | undefined;
        let matrix = entry.matrix;
        if (!matrix && Array.isArray(entry.grid)) {
          matrix = gridRowsToMatrix(entry.grid as unknown[], charsMap);
        } else if (Array.isArray(matrix) && matrix.length > 0 && typeof matrix[0] === 'string') {
          matrix = gridRowsToMatrix(matrix as unknown[], charsMap);
        }
        if (!Array.isArray(matrix)) {
          errors.push(`"layers[${li}].matrix" debe ser un array de filas (o grid de strings).`);
          continue;
        }
        if (matrix.length !== h) {
          errors.push(`"layers[${li}].matrix" tiene ${matrix.length} filas y se esperaban ${h}.`);
        }
        let rowError = false;
        for (let y = 0; y < matrix.length; y++) {
          const row = matrix[y];
          if (!Array.isArray(row)) {
            errors.push(`"layers[${li}].matrix[${y}]" debe ser un array.`);
            rowError = true;
            break;
          }
          if (row.length !== w) {
            errors.push(`"layers[${li}].matrix[${y}]" tiene ${row.length} columnas y se esperaban ${w}.`);
            rowError = true;
            break;
          }
          for (let x = 0; x < row.length; x++) {
            const value = row[x];
            if (typeof value !== 'number' || !Number.isInteger(value)) {
              errors.push(`"layers[${li}].matrix[${y}][${x}]" no es un entero (recibido: ${JSON.stringify(value)}).`);
              rowError = true;
              break;
            }
            const paletteSize = palette.length > 0 ? palette.length : knownPaletteSize;
            if (value < TRANSPARENT || (paletteSize !== undefined && value >= paletteSize)) {
              errors.push(
                `"layers[${li}].matrix[${y}][${x}]" = ${value} está fuera de rango (paleta: ${paletteSize ?? 'desconocida'}, -1 = transparente).`,
              );
              rowError = true;
              break;
            }
          }
          if (rowError) break;
        }
        if (rowError) continue;
        if (matrix.length * w > MAX_CELLS) {
          errors.push(`"layers[${li}]" excede el máximo de ${MAX_CELLS} celdas.`);
          continue;
        }
        layers.push({
          name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 64) : `IA ${li + 1}`,
          visible: entry.visible !== false,
          matrix: matrix as number[][],
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      width: width as number,
      height: height as number,
      palette,
      layers,
    },
  };
}

/**
 * Normalización tolerante de respuestas de modelos pequeños.
 *
 * Los modelos locales cometen errores sistemáticos y previsibles: matrices con
 * una fila menos (típico desfase 0..15), celdas fuera de rango o filas con una
 * celda de más. En lugar de descartar el resultado, se repara el formato y se
 * devuelven REPARACIONES visibles para el usuario. El resultado reparado pasa
 * después por la validación estricta: nunca se aplica nada inválido.
 */
export interface NormalizedAiResult {
  result: AiResultPayload;
  repairs: string[];
}

function repairMatrix(
  rawRows: unknown,
  width: number,
  height: number,
  paletteSize: number | undefined,
  charsMap?: Record<string, number>,
): { matrix: number[][]; repairs: string[] } | null {
  if (!Array.isArray(rawRows)) return null;
  const rows: unknown[] =
    rawRows.length > 0 && typeof rawRows[0] === 'string'
      ? gridRowsToMatrix(rawRows, charsMap)
      : (rawRows as unknown[]);
  const repairs: string[] = [];
  const matrix: number[][] = [];
  let missingRows = 0;
  let extraRows = 0;
  let missingCells = 0;
  let extraCells = 0;
  let clampedCells = 0;

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    if (!Array.isArray(row)) {
      missingRows += 1;
      matrix.push(Array.from({ length: width }, () => TRANSPARENT));
      continue;
    }
    const out: number[] = [];
    for (let x = 0; x < width; x++) {
      const raw = row[x];
      if (typeof raw === 'number' && Number.isInteger(raw)) {
        if (raw >= TRANSPARENT && (paletteSize === undefined || raw < paletteSize)) {
          out.push(raw);
        } else {
          clampedCells += 1;
          out.push(TRANSPARENT);
        }
      } else {
        if (raw === undefined) missingCells += 1;
        else clampedCells += 1;
        out.push(TRANSPARENT);
      }
    }
    if (row.length > width) extraCells += row.length - width;
    matrix.push(out);
  }
  if (rows.length > height) extraRows = rows.length - height;

  const details: string[] = [];
  if (missingRows > 0) details.push(`${missingRows} fila(s) faltante(s) rellena(s) con transparencia`);
  if (extraRows > 0) details.push(`${extraRows} fila(s) sobrante(s) eliminada(s)`);
  if (missingCells > 0) details.push(`${missingCells} celda(s) faltante(s) rellena(s)`);
  if (extraCells > 0) details.push(`${extraCells} celda(s) sobrante(s) eliminada(s)`);
  if (clampedCells > 0) details.push(`${clampedCells} celda(s) fuera de rango pasada(s) a transparente`);
  if (details.length > 0) repairs.push(details.join('; ') + '.');
  return { matrix, repairs };
}

/**
 * Validación con reparación de formato. Si el payload estricto falla solo por
 * problemas de dimensiones/valores, se normaliza y se validan los resultados.
 */
export function normalizeAiResult(
  data: unknown,
  mode: AiMode = 'full',
  knownPaletteSize?: number,
): ValidationResult<NormalizedAiResult> {
  const strict = validateAiResult(data, mode, knownPaletteSize);
  if (strict.ok) return { ok: true, value: { result: strict.value, repairs: [] } };

  if (typeof data !== 'object' || data === null || Array.isArray(data)) return strict;
  const rec = data as Record<string, unknown>;
  const needMatrix = mode === 'matrix' || mode === 'full';

  // Se necesita al menos un tamaño interpretable.
  const width = typeof rec.width === 'number' && Number.isInteger(rec.width) ? rec.width : 0;
  const height = typeof rec.height === 'number' && Number.isInteger(rec.height) ? rec.height : 0;
  if (needMatrix && (width < LIMITS.minSize || width > LIMITS.maxSize || height < LIMITS.minSize || height > LIMITS.maxSize)) {
    return strict;
  }

  const repairs: string[] = [];
  let palette: string[] = [];
  if (Array.isArray(rec.palette)) {
    for (const entry of rec.palette) {
      const hex = coercePaletteEntry(entry);
      if (hex) palette.push(hex);
      else repairs.push(`Color de paleta descartado: ${JSON.stringify(entry)}.`);
    }
  }
  const paletteSize = palette.length > 0 ? palette.length : knownPaletteSize;

  if (!needMatrix) {
    if (palette.length === 0) return strict;
    return {
      ok: true,
      value: {
        result: { width, height, palette, layers: [] },
        repairs,
      },
    };
  }

  if (!Array.isArray(rec.layers) || rec.layers.length === 0) return strict;
  const layers: AiResultPayload['layers'] = [];
  const charsMap = (rec.chars ?? rec.charMap) as Record<string, number> | undefined;
  for (let li = 0; li < rec.layers.length; li++) {
    const entry = rec.layers[li] as Record<string, unknown>;
    if (typeof entry !== 'object' || entry === null) return strict;
    const rawMatrix = entry.grid ?? entry.matrix;
    const repaired = repairMatrix(rawMatrix, width, height, paletteSize, charsMap);
    if (!repaired) return strict;
    for (const r of repaired.repairs) repairs.push(`layers[${li}].matrix: ${r}`);
    layers.push({
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.slice(0, 64) : `IA ${li + 1}`,
      visible: entry.visible !== false,
      matrix: repaired.matrix,
    });
  }

  const candidate: AiResultPayload = { width, height, palette, layers };
  const revalidated = validateAiResult(candidate, mode, knownPaletteSize);
  if (!revalidated.ok) return strict;

  return { ok: true, value: { result: revalidated.value, repairs } };
}

/** Extracción + validación en un solo paso (lo que usa el panel de IA). */
export function parseAiResponse(
  raw: string,
  mode: AiMode,
  knownPaletteSize?: number,
): ValidationResult<AiResultPayload> {
  const extracted = extractJson(raw);
  if (!extracted.ok) return extracted;
  return validateAiResult(extracted.value, mode, knownPaletteSize);
}

/** Como `parseAiResponse`, pero reparando errores de formato previsibles. */
export function parseAiResponseNormalized(
  raw: string,
  mode: AiMode,
  knownPaletteSize?: number,
): ValidationResult<NormalizedAiResult> {
  const extracted = extractJson(raw);
  if (!extracted.ok) return extracted;
  return normalizeAiResult(extracted.value, mode, knownPaletteSize);
}

/**
 * Intenta extraer un resultado parcial utilizable a partir de una respuesta
 * truncada o en streaming en tiempo real.
 * Reconstruye tantas filas completadas como existan y rellena el resto con transparencia.
 */
export function extractPartialAiResult(
  raw: string,
  targetWidth: number,
  targetHeight: number,
  fallbackPalette: Array<string | { hex: string }> = [],
): { result: AiResultPayload; completedRows: number } | null {
  const text = raw.trim();
  if (!text) return null;

  // 1. Paleta de colores
  let palette: string[] = [];
  const paletteMatch = text.match(/"palette"\s*:\s*\[([\s\S]*?)\]/);
  if (paletteMatch) {
    try {
      const parsedArr = JSON.parse(`[${paletteMatch[1]}]`) as unknown[];
      for (const item of parsedArr) {
        const hex = coercePaletteEntry(item);
        if (hex) palette.push(hex);
      }
    } catch {
      const hexMatches = paletteMatch[1].match(/#[0-9a-fA-F]{3,8}/g);
      if (hexMatches) {
        for (const h of hexMatches) {
          const hex = coercePaletteEntry(h);
          if (hex) palette.push(hex);
        }
      }
    }
  }

  if (palette.length === 0) {
    palette =
      fallbackPalette.length > 0
        ? fallbackPalette.map((c) => (typeof c === 'string' ? c : c.hex))
        : ['#000000', '#ffffff'];
  }

  // 2. Dimensiones
  let width = targetWidth;
  let height = targetHeight;
  const wMatch = text.match(/"width"\s*:\s*(\d+)/);
  if (wMatch) {
    const parsedW = parseInt(wMatch[1], 10);
    if (parsedW >= LIMITS.minSize && parsedW <= LIMITS.maxSize) width = parsedW;
  }
  const hMatch = text.match(/"height"\s*:\s*(\d+)/);
  if (hMatch) {
    const parsedH = parseInt(hMatch[1], 10);
    if (parsedH >= LIMITS.minSize && parsedH <= LIMITS.maxSize) height = parsedH;
  }

  // 3. Mapeo de caracteres opcional
  let charsMap: Record<string, number> | undefined;
  const charsMatch = text.match(/"chars"\s*:\s*\{([^}]*)\}/);
  if (charsMatch) {
    try {
      charsMap = JSON.parse(`{${charsMatch[1]}}`) as Record<string, number>;
    } catch {
      /* sin chars map */
    }
  }

  // 4. Filas de grid o matrix
  const parsedRows: number[][] = [];

  // Buscar strings en "grid": [ "...", "..." ]
  const gridSection = text.match(/"grid"\s*:\s*\[([\s\S]*)/);
  if (gridSection) {
    const stringMatches = Array.from(gridSection[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g));
    for (const sm of stringMatches) {
      const rowChars = sm[1];
      const decodedRow = gridRowsToMatrix([rowChars], charsMap)[0];
      if (decodedRow) parsedRows.push(decodedRow);
    }
  }

  // Si no hubo grid, buscar arrays en "matrix": [ [0, 1], ... ]
  if (parsedRows.length === 0) {
    const matrixSection = text.match(/"matrix"\s*:\s*\[([\s\S]*)/);
    if (matrixSection) {
      const arrayMatches = Array.from(matrixSection[1].matchAll(/\[\s*(-?\d+(?:\s*,\s*-?\d+)*)\s*\]/g));
      for (const am of arrayMatches) {
        const nums = am[1]
          .split(',')
          .map((n) => parseInt(n.trim(), 10))
          .filter((n) => !isNaN(n));
        if (nums.length > 0) parsedRows.push(nums);
      }
    }
  }

  if (parsedRows.length === 0) {
    return null;
  }

  // Construir la matriz completa rellenando con transparencia las filas que falten
  const fullMatrix: number[][] = [];
  const validRowCount = Math.min(parsedRows.length, height);
  const paletteLen = palette.length;

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    const sourceRow = parsedRows[y];
    for (let x = 0; x < width; x++) {
      if (sourceRow && x < sourceRow.length) {
        const val = sourceRow[x];
        row.push(val >= 0 && val < paletteLen ? val : TRANSPARENT);
      } else {
        row.push(TRANSPARENT);
      }
    }
    fullMatrix.push(row);
  }

  return {
    result: {
      width,
      height,
      palette,
      layers: [
        {
          name: validRowCount < height ? 'IA (parcial)' : 'IA',
          visible: true,
          matrix: fullMatrix,
        },
      ],
    },
    completedRows: validRowCount,
  };
}
