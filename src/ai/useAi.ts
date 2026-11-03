/**
 * Lógica de generación y aplicación de resultados de IA.
 *
 * Toda respuesta se valida con un esquema estricto antes de tocar el documento.
 * Estrategias para modelos pequeños:
 *  - Reintento automático cuando la respuesta llega vacía o truncada.
 *  - Ampliación automática del límite de tokens según el tamaño del lienzo.
 *  - Generación por bloques (16x16) para lienzos grandes, con contexto de
 *    bordes para que las costuras casen (ver `ai/tiles.ts`).
 */
import { useCallback, useRef } from 'react';
import type { AiMode, AiResultPayload, AiSettings, Layer, ProjectDoc, Rect } from '../types/index.ts';
import { LIMITS, TRANSPARENT } from '../types/index.ts';
import { parseHexColor } from '../core/color.ts';
import { createLayer } from '../core/layers.ts';
import { fromRows, toRows, cloneMatrix, extractRegion, blitMatrix } from '../core/matrix.ts';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildPipelineStage1Prompt,
  buildPipelineStage2Prompt,
  buildPipelineStage3Prompt,
  buildInpaintPrompt,
} from './prompts.ts';
import { describeAiError, generateRaw, listModels, AiError } from './client.ts';
import { extractJson, parseAiResponseNormalized, getStrictJsonSchema, extractPartialAiResult, gridRowsToMatrix } from './schema.ts';
import { needsRescaling, computeBaseSize, upscaleRows, smoothPixelArtEdges } from './rescale.ts';
import {
  buildPlanPrompt,
  buildTilePrompt,
  createEmptyGrid,
  estimateTokens,
  extractTileContext,
  mergeTileMatrix,
  needsTiling,
  planTiles,
} from './tiles.ts';
import { useEditor } from '../state/editorStore.tsx';

/** Error de validación del resultado (con errores por campo). */
class AiValidationError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super('La respuesta no superó la validación.');
    this.errors = errors;
    this.name = 'AiValidationError';
  }
}

export function aiResultToDoc(result: AiResultPayload): ProjectDoc {
  const palette = result.palette.map((hex) => parseHexColor(hex) ?? { hex: '#000000', alpha: 255 });
  const layers: Layer[] = result.layers.map((payload, index) => {
    const base = createLayer(result.width, result.height, payload.name || `IA ${index + 1}`);
    return {
      ...base,
      visible: payload.visible !== false,
      matrix: fromRows(payload.matrix, result.width, result.height),
    };
  });
  return { width: result.width, height: result.height, palette, layers };
}

interface SingleShotOutcome {
  result: AiResultPayload;
  paletteFallback: boolean;
  raw: string;
  repairs: string[];
}

interface TiledOutcome {
  result: AiResultPayload;
  warnings: string[];
}

export function useAi(): {
  testConnection: () => Promise<void>;
  generate: () => Promise<void>;
  cancel: () => void;
  applyFull: () => void;
  applyPaletteOnly: () => void;
  applyAsLayers: () => void;
  applyToSelection: () => void;
  discard: () => void;
} {
  const { dispatch, stateRef, toast } = useEditor();
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef(0);
  const lastPartialTextRef = useRef('');

  const reportProgress = useCallback(
    (progress: { elapsedMs: number; chars: number; stage?: string; partialText?: string }) => {
      if (progress.partialText) {
        lastPartialTextRef.current = progress.partialText;
      }
      const now = Date.now();
      if (now - lastProgressRef.current < 200) return;
      lastProgressRef.current = now;

      const doc = stateRef.current.history.present;
      const ai = stateRef.current.ai;
      let partialPreviewPatch: { preview?: typeof ai.preview } = {};

      if (progress.partialText && progress.partialText.length > 20) {
        const rescued = extractPartialAiResult(progress.partialText, doc.width, doc.height, doc.palette);
        if (rescued && rescued.completedRows > 0) {
          partialPreviewPatch = {
            preview: {
              result: rescued.result,
              mode: ai.mode,
              prompt: ai.prompt,
              raw: progress.partialText,
              paletteFallback: false,
            },
          };
        }
      }

      dispatch({
        type: 'ai/patch',
        patch: {
          progress: {
            elapsedMs: progress.elapsedMs,
            chars: progress.chars,
            stage: progress.stage,
          },
          ...partialPreviewPatch,
        },
      });
    },
    [dispatch, stateRef],
  );

  const testConnection = useCallback(async () => {
    const settings = stateRef.current.ai.settings;
    dispatch({ type: 'ai/patch', patch: { status: 'connecting', error: null, connectionInfo: null } });
    try {
      const models = await listModels(settings);
      dispatch({
        type: 'ai/patch',
        patch: {
          status: 'idle',
          models,
          connectionInfo: `Conectado · ${models.length} modelo(s) disponible(s)`,
          error: null,
        },
      });
      toast(`Conexión correcta con ${settings.baseUrl} (${models.length} modelos).`, 'success');
    } catch (e) {
      const message = describeAiError(e);
      dispatch({ type: 'ai/patch', patch: { status: 'error', error: message, connectionInfo: null } });
      toast(`Error de conexión: ${message}`, 'error');
    }
  }, [dispatch, stateRef, toast]);

  /** Completa el resultado cuando el modo no exige todos los campos. */
  function normalizeForMode(result: AiResultPayload, mode: AiMode, doc: ProjectDoc): AiResultPayload {
    const palette = result.palette.length > 0 ? result.palette : doc.palette.map((c) => c.hex);
    const width = result.width > 0 ? result.width : doc.width;
    const height = result.height > 0 ? result.height : doc.height;
    const layers =
      result.layers.length > 0
        ? result.layers
        : doc.layers.map((l) => ({
            name: l.name,
            visible: l.visible,
            matrix: Array.from({ length: doc.height }, (_, y) =>
              Array.from({ length: doc.width }, (_, x) => l.matrix[y * doc.width + x]),
            ),
          }));
    if (mode === 'palette') {
      return { width, height, palette, layers: [] };
    }
    return { width, height, palette, layers };
  }

  /** Una sola llamada al modelo, con un reintento ante respuestas vacías. */
  async function runSingleShot(
    settings: AiSettings,
    mode: AiMode,
    description: string,
    doc: ProjectDoc,
    signal: AbortSignal,
  ): Promise<SingleShotOutcome> {
    const user = buildUserPrompt({
      mode,
      description,
      width: doc.width,
      height: doc.height,
      palette: mode === 'matrix' ? doc.palette.map((c) => c.hex) : undefined,
    });
    const schema = getStrictJsonSchema(mode, doc.width, doc.height);

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text: raw } = await generateRaw(settings, {
          system: SYSTEM_PROMPT,
          user,
          mode,
          signal,
          schema,
          onProgress: (progress) => reportProgress(progress),
        });
        let parsed = parseAiResponseNormalized(raw, mode, mode === 'matrix' ? doc.palette.length : undefined);
        let paletteFallback = false;

        // Recuperación: si lo único inválido es la paleta, se reutiliza la del proyecto.
        if (!parsed.ok && mode === 'full') {
          const retry = parseAiResponseNormalized(raw, 'matrix', doc.palette.length);
          if (retry.ok && retry.value.result.layers.length > 0) {
            parsed = retry;
            paletteFallback = true;
          }
        }
        if (!parsed.ok) throw new AiValidationError(parsed.errors);
        return {
          result: normalizeForMode(parsed.value.result, mode, doc),
          paletteFallback,
          raw,
          repairs: parsed.value.repairs,
        };
      } catch (e) {
        const isFormatError = e instanceof AiError && e.kind === 'format';
        if (isFormatError && attempt === 0 && !signal.aborted) {
          toast('La respuesta llegó vacía o incompleta; reintentando automáticamente…', 'info');
          continue;
        }
        throw e;
      }
    }
    throw new AiError('format', 'No se obtuvo una respuesta utilizable tras dos intentos.');
  }

  /** Pipeline multi-etapa: 1) Paleta y concepto -> 2) Silueta base -> 3) Detallado y sombreado */
  async function runPipeline(
    settings: AiSettings,
    description: string,
    doc: ProjectDoc,
    signal: AbortSignal,
  ): Promise<SingleShotOutcome> {
    const repairs: string[] = [];
    const w = doc.width;
    const h = doc.height;

    // Etapa 1: Paleta y concepto
    reportProgress({ elapsedMs: 0, chars: 0, stage: 'Etapa 1/3 (Paleta)' });
    const stage1User = buildPipelineStage1Prompt(description);
    const stage1Schema = getStrictJsonSchema('palette', w, h);
    let palette: string[] = [];
    let concept = '';

    try {
      const { text: text1 } = await generateRaw(settings, {
        system: SYSTEM_PROMPT,
        user: stage1User,
        mode: 'palette',
        signal,
        schema: stage1Schema,
        onProgress: (p) => reportProgress({ ...p, stage: 'Etapa 1/3 (Paleta)' }),
      });
      const parsed1 = extractJson(text1);
      if (parsed1.ok && typeof parsed1.value === 'object' && parsed1.value !== null) {
        const val = parsed1.value as Record<string, unknown>;
        if (typeof val.concept === 'string') concept = val.concept.trim();
        if (Array.isArray(val.palette)) {
          for (const item of val.palette) {
            const hex = typeof item === 'string' ? parseHexColor(item) : null;
            if (hex) palette.push(hex.hex);
          }
        }
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }

    if (palette.length < 2) {
      palette = doc.palette.map((c) => c.hex);
      repairs.push('Etapa 1: se usó la paleta del proyecto como base');
    }

    // Etapa 2: Silueta y estructura base
    reportProgress({ elapsedMs: 0, chars: 0, stage: 'Etapa 2/3 (Silueta)' });
    const stage2User = buildPipelineStage2Prompt(description, w, h, palette, concept);
    const stage2Schema = getStrictJsonSchema('matrix', w, h);
    let baseGrid: string[] = [];

    try {
      const { text: text2 } = await generateRaw(settings, {
        system: SYSTEM_PROMPT,
        user: stage2User,
        mode: 'matrix',
        signal,
        schema: stage2Schema,
        onProgress: (p) => reportProgress({ ...p, stage: 'Etapa 2/3 (Silueta)' }),
      });
      const parsed2 = parseAiResponseNormalized(text2, 'matrix', palette.length);
      if (parsed2.ok && parsed2.value.result.layers.length > 0) {
        const m = parsed2.value.result.layers[0].matrix;
        baseGrid = m.map((row) => row.map((cell) => (cell < 0 ? '.' : String(cell))).join(''));
        for (const r of parsed2.value.repairs) repairs.push(`Etapa 2 (Silueta): ${r}`);
        const silMatrix = gridRowsToMatrix(baseGrid);
        dispatch({
          type: 'ai/patch',
          patch: {
            preview: {
              result: {
                width: w,
                height: h,
                palette,
                layers: [{ name: 'IA (silueta base)', visible: true, matrix: silMatrix }],
              },
              mode: 'pipeline',
              prompt: description,
              raw: '(Etapa 2/3 completada: silueta base)',
              paletteFallback: false,
            },
          },
        });
      }
    } catch (e) {
      if (signal.aborted) throw e;
    }

    if (baseGrid.length === 0) {
      baseGrid = Array.from({ length: h }, () => '.'.repeat(w));
    }

    // Etapa 3: Sombreado, luces y acabado final
    reportProgress({ elapsedMs: 0, chars: 0, stage: 'Etapa 3/3 (Detalles)' });
    const stage3User = buildPipelineStage3Prompt(description, w, h, palette, baseGrid);
    const stage3Schema = getStrictJsonSchema('full', w, h);

    const { text: raw3 } = await generateRaw(settings, {
      system: SYSTEM_PROMPT,
      user: stage3User,
      mode: 'full',
      signal,
      schema: stage3Schema,
      onProgress: (p) => reportProgress({ ...p, stage: 'Etapa 3/3 (Detalles)' }),
    });

    let parsed3 = parseAiResponseNormalized(raw3, 'full', palette.length);
    let paletteFallback = false;
    if (!parsed3.ok) {
      const retry = parseAiResponseNormalized(raw3, 'matrix', palette.length);
      if (retry.ok && retry.value.result.layers.length > 0) {
        parsed3 = retry;
        paletteFallback = true;
      }
    }

    if (!parsed3.ok) throw new AiValidationError(parsed3.errors);

    for (const r of parsed3.value.repairs) repairs.push(`Etapa 3 (Detalles): ${r}`);

    const finalResult = normalizeForMode(parsed3.value.result, 'full', doc);
    if (finalResult.palette.length === 0) {
      finalResult.palette = palette;
    }

    return {
      result: finalResult,
      paletteFallback,
      raw: raw3,
      repairs,
    };
  }

  interface RescaleOutcome {
    result: AiResultPayload;
    raw: string;
    repairs: string[];
    paletteFallback: boolean;
    baseW: number;
    baseH: number;
    scaleFactor: number;
  }

  /**
   * Generación piramidal para lienzos grandes (>= 64px):
   * 1) Genera la figura holística a resolución reducida (<= 32x32) con el pipeline multi-etapa.
   * 2) Proyecta la matriz al tamaño completo mediante reescalado pixel-perfect.
   * 3) Aplica suavizado de aristas (corner anti-aliasing) conservando la paleta.
   */
  async function runRescaledPipeline(
    settings: AiSettings,
    description: string,
    doc: ProjectDoc,
    signal: AbortSignal,
  ): Promise<RescaleOutcome> {
    const { baseW, baseH, scaleFactor } = computeBaseSize(doc.width, doc.height);
    const virtualDoc: ProjectDoc = {
      ...doc,
      width: baseW,
      height: baseH,
    };

    reportProgress({
      elapsedMs: 0,
      chars: 0,
      stage: `Fase 1/2: Base compositiva (${baseW}×${baseH})`,
    });

    const baseOutcome = await runPipeline(settings, description, virtualDoc, signal);

    reportProgress({
      elapsedMs: 0,
      chars: 0,
      stage: `Fase 2/2: Reescalando a ${doc.width}×${doc.height}…`,
    });

    const upscaledLayers = baseOutcome.result.layers.map((layer) => {
      const scaled = upscaleRows(layer.matrix, baseW, baseH, doc.width, doc.height);
      const smoothed = smoothPixelArtEdges(scaled, doc.width, doc.height, baseOutcome.result.palette.length);
      return {
        name: layer.name,
        visible: layer.visible,
        matrix: smoothed.matrix,
      };
    });

    const finalResult: AiResultPayload = {
      width: doc.width,
      height: doc.height,
      palette: baseOutcome.result.palette,
      layers: upscaledLayers,
    };

    return {
      result: finalResult,
      raw: baseOutcome.raw,
      paletteFallback: baseOutcome.paletteFallback,
      repairs: [
        `Reescalado piramidal: base ${baseW}×${baseH} proyectada a ${doc.width}×${doc.height} (factor ×${scaleFactor}).`,
        ...baseOutcome.repairs,
      ],
      baseW,
      baseH,
      scaleFactor,
    };
  }

  interface InpaintOutcome {
    result: AiResultPayload;
    raw: string;
    repairs: string[];
    selectionRect: Rect;
  }

  /** Inpainting: modificación de una región específica seleccionada */
  async function runInpaint(
    settings: AiSettings,
    description: string,
    doc: ProjectDoc,
    signal: AbortSignal,
  ): Promise<InpaintOutcome> {
    const selection = stateRef.current.selection;
    if (!selection) {
      throw new AiError('format', 'No hay ninguna región seleccionada. Usa la herramienta Selección (S) para delimitar el área a modificar.');
    }

    const sel: Rect = {
      x: Math.max(0, selection.x),
      y: Math.max(0, selection.y),
      w: Math.min(selection.w, doc.width - Math.max(0, selection.x)),
      h: Math.min(selection.h, doc.height - Math.max(0, selection.y)),
    };

    if (sel.w < 2 || sel.h < 2) {
      throw new AiError('format', 'El área seleccionada es demasiado pequeña (mínimo 2×2 píxeles).');
    }

    const activeLayer = doc.layers.find((l) => l.id === stateRef.current.activeLayerId) ?? doc.layers[0];
    const currentRegion = extractRegion(activeLayer.matrix, doc.width, sel);
    const currentRows = toRows(currentRegion, sel.w, sel.h);
    const currentGrid = currentRows.map((r) => r.map((c) => (c < 0 ? '.' : String(c))).join(''));

    // Contexto de bordes adyacentes
    let contextTop: string | undefined;
    let contextBottom: string | undefined;
    let contextLeft: string | undefined;
    let contextRight: string | undefined;

    if (sel.y > 0) {
      const topRow = Array.from({ length: sel.w }, (_, i) => activeLayer.matrix[(sel.y - 1) * doc.width + sel.x + i]);
      contextTop = topRow.map((c) => (c < 0 ? '.' : String(c))).join('');
    }
    if (sel.y + sel.h < doc.height) {
      const botRow = Array.from({ length: sel.w }, (_, i) => activeLayer.matrix[(sel.y + sel.h) * doc.width + sel.x + i]);
      contextBottom = botRow.map((c) => (c < 0 ? '.' : String(c))).join('');
    }
    if (sel.x > 0) {
      const leftCol = Array.from({ length: sel.h }, (_, i) => activeLayer.matrix[(sel.y + i) * doc.width + sel.x - 1]);
      contextLeft = leftCol.map((c) => (c < 0 ? '.' : String(c))).join('');
    }
    if (sel.x + sel.w < doc.width) {
      const rightCol = Array.from({ length: sel.h }, (_, i) => activeLayer.matrix[(sel.y + i) * doc.width + sel.x + sel.w]);
      contextRight = rightCol.map((c) => (c < 0 ? '.' : String(c))).join('');
    }

    const paletteHex = doc.palette.map((c) => c.hex);
    const userPrompt = buildInpaintPrompt({
      description,
      selection: sel,
      canvasWidth: doc.width,
      canvasHeight: doc.height,
      palette: paletteHex,
      currentGrid,
      contextTop,
      contextBottom,
      contextLeft,
      contextRight,
    });

    const schema = getStrictJsonSchema('inpaint', sel.w, sel.h);

    const { text: raw } = await generateRaw(settings, {
      system: SYSTEM_PROMPT,
      user: userPrompt,
      mode: 'inpaint',
      signal,
      schema,
      onProgress: (p) => reportProgress({ ...p, stage: `Inpainting (${sel.w}×${sel.h})` }),
    });

    const parsed = parseAiResponseNormalized(raw, 'inpaint', paletteHex.length);
    if (!parsed.ok) throw new AiValidationError(parsed.errors);

    return {
      result: {
        width: sel.w,
        height: sel.h,
        palette: paletteHex,
        layers: parsed.value.result.layers,
      },
      raw,
      repairs: parsed.value.repairs,
      selectionRect: sel,
    };
  }

  /** Generación por bloques para lienzos grandes. */
  async function runTiled(
    settings: AiSettings,
    mode: AiMode,
    description: string,
    doc: ProjectDoc,
    signal: AbortSignal,
  ): Promise<TiledOutcome> {
    const plan = planTiles(doc.width, doc.height, Math.max(4, settings.tileSize));
    const merged = createEmptyGrid(doc.width, doc.height);
    let palette: string[] = mode === 'matrix' ? doc.palette.map((c) => c.hex) : [];
    const warnings: string[] = [];
    const usedProjectPalette = mode === 'matrix';

    // Fase 1 (mejor esfuerzo): plan espacial común para que los bloques casen.
    let planText = '';
    try {
      const { text } = await generateRaw(settings, {
        system: SYSTEM_PROMPT,
        user: buildPlanPrompt(description, doc.width, doc.height),
        mode: 'palette',
        signal,
        onProgress: (progress) => reportProgress({ ...progress, stage: 'Plan' }),
      });
      const extracted = extractJson(text);
      const planValue = extracted.ok ? (extracted.value as { plan?: unknown }).plan : undefined;
      if (typeof planValue === 'string' && planValue.trim()) planText = planValue.trim().slice(0, 600);
    } catch (e) {
      if (signal.aborted) throw e;
      // Sin plan se continúa igualmente: no es bloqueante.
    }

    for (const tile of plan) {
      if (signal.aborted) throw new DOMException('Generación cancelada', 'AbortError');
      const context = extractTileContext(merged, tile);
      const isFirst = tile.index === 0;
      const tileMode: AiMode = isFirst ? 'full' : 'matrix';

      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        if (signal.aborted) throw new DOMException('Generación cancelada', 'AbortError');
        const user = buildTilePrompt({
          description,
          tile,
          canvasWidth: doc.width,
          canvasHeight: doc.height,
          palette: palette.length > 0 ? palette : undefined,
          context,
          plan: planText || undefined,
          reinforce: attempt > 0,
        });
        try {
          const { text } = await generateRaw(settings, {
            system: SYSTEM_PROMPT,
            user,
            mode: tileMode,
            signal,
            onProgress: (progress) =>
              reportProgress({ ...progress, stage: `Bloque ${tile.index + 1}/${plan.length}` }),
          });
          const parsed = parseAiResponseNormalized(text, tileMode, palette.length > 0 ? palette.length : undefined);
          if (!parsed.ok || parsed.value.result.layers.length === 0) {
            if (attempt === 0) {
              toast(`El bloque ${tile.index + 1} llegó inválido; reintentando…`, 'info');
              continue;
            }
            warnings.push(`Bloque ${tile.index + 1} descartado: ${parsed.ok ? 'sin capas' : parsed.errors[0]}`);
            done = true;
            continue;
          }
          for (const repair of parsed.value.repairs) {
            warnings.push(`Bloque ${tile.index + 1}: ${repair}`);
          }
          const matrix = parsed.value.result.layers[0].matrix;
          if (palette.length === 0 && parsed.value.result.palette.length > 0) {
            palette = parsed.value.result.palette;
          }
          mergeTileMatrix(merged, tile, matrix);
          done = true;
          dispatch({
            type: 'ai/patch',
            patch: {
              preview: {
                result: {
                  width: doc.width,
                  height: doc.height,
                  palette: palette.length > 0 ? palette : doc.palette.map((c) => c.hex),
                  layers: [{ name: 'IA (por bloques)', visible: true, matrix: merged.map((r) => [...r]) }],
                },
                mode,
                prompt: description,
                raw: `(bloque ${tile.index + 1}/${plan.length})`,
                paletteFallback: false,
              },
            },
          });
        } catch (e) {
          if (signal.aborted) throw e;
          if (attempt === 0) {
            toast(`El bloque ${tile.index + 1} falló; reintentando…`, 'info');
          } else {
            warnings.push(`Bloque ${tile.index + 1}: ${describeAiError(e)}`);
            done = true;
          }
        }
      }
    }

    if (palette.length === 0 && !usedProjectPalette) {
      palette = doc.palette.map((c) => c.hex);
      warnings.push('El primer bloque no devolvió paleta válida: se usó la paleta del proyecto.');
    }

    // Sanidad final: ningún índice fuera de la paleta.
    const safe = merged.map((row) =>
      row.map((value) => (value >= 0 && value < palette.length ? value : TRANSPARENT)),
    );

    // Aviso de calidad: si el resultado es casi plano, el modelo no ha dibujado.
    const paintedValues = new Map<number, number>();
    let paintedCount = 0;
    for (const row of safe) {
      for (const value of row) {
        if (value >= 0) {
          paintedCount += 1;
          paintedValues.set(value, (paintedValues.get(value) ?? 0) + 1);
        }
      }
    }
    const top = Math.max(0, ...paintedValues.values());
    if (paintedCount > 0 && top / paintedCount > 0.9) {
      warnings.push(
        'El resultado quedó casi plano (un solo color dominante): el modelo no ha sabido dibujar la figura. ' +
          'Prueba con un modelo más capaz, un lienzo más pequeño, bloques de 8×8 o pulsa Regenerar.',
      );
    }

    return {
      result: {
        width: doc.width,
        height: doc.height,
        palette,
        layers: [{ name: 'IA (por bloques)', visible: true, matrix: safe }],
      },
      warnings,
    };
  }

  const generate = useCallback(async () => {
    const snapshot = stateRef.current;
    const ai = snapshot.ai;
    const doc = snapshot.history.present;
    const prompt = ai.prompt.trim();
    if (!prompt) {
      toast('Escribe una descripción del sprite que quieres generar.', 'error');
      return;
    }
    if (!ai.settings.model.trim()) {
      toast('Indica el nombre del modelo (p. ej. qwen2.5-coder:1.5b).', 'error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastProgressRef.current = 0;
    lastPartialTextRef.current = '';

    const isLarge = needsRescaling(doc.width, doc.height) && ai.mode !== 'inpaint' && ai.mode !== 'palette';
    const tiled = !isLarge && ai.mode !== 'palette' && ai.mode !== 'inpaint' && needsTiling(doc.width, doc.height);
    let settings = ai.settings;
    if (!tiled && !isLarge && ai.mode !== 'palette' && ai.mode !== 'inpaint') {
      const needed = estimateTokens(doc.width, doc.height, ai.mode === 'full' ? 2 : 1);
      if (settings.maxTokens < needed) {
        settings = { ...settings, maxTokens: needed };
        dispatch({ type: 'ai/settings', patch: { maxTokens: needed } });
        toast(`Límite de tokens ampliado a ${needed} para un lienzo de ${doc.width}x${doc.height}.`, 'info');
      }
    }

    dispatch({
      type: 'ai/patch',
      patch: {
        status: 'generating',
        error: null,
        validationErrors: [],
        preview: null,
        progress: null,
        warnings: [],
      },
    });

    try {
      if (ai.mode === 'inpaint') {
        const { result, raw, repairs, selectionRect } = await runInpaint(settings, prompt, doc, controller.signal);
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'ok',
            preview: {
              result,
              mode: 'inpaint',
              prompt,
              raw,
              paletteFallback: false,
              selectionRect,
            },
            warnings: repairs,
            error: null,
            validationErrors: [],
            progress: null,
          },
        });
        toast(`Inpainting completado para la región ${selectionRect.w}×${selectionRect.h}.`, 'success');
        return;
      }

      if (isLarge) {
        const { result, raw, repairs, paletteFallback, baseW, baseH, scaleFactor } = await runRescaledPipeline(
          settings,
          prompt,
          doc,
          controller.signal,
        );
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'ok',
            preview: {
              result,
              mode: ai.mode,
              prompt,
              raw,
              paletteFallback,
            },
            warnings: repairs,
            error: null,
            validationErrors: [],
            progress: null,
          },
        });
        toast(
          `Sprite generado a ${doc.width}×${doc.height} con reescalado piramidal (base ${baseW}×${baseH} ×${scaleFactor}).`,
          'success',
        );
        return;
      }

      if (tiled) {
        const { result, warnings } = await runTiled(settings, ai.mode, prompt, doc, controller.signal);
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'ok',
            preview: {
              result,
              mode: ai.mode,
              prompt,
              raw: `(generado por bloques de ${Math.max(4, settings.tileSize)}x${Math.max(4, settings.tileSize)}: ${planTiles(doc.width, doc.height, Math.max(4, settings.tileSize)).length} llamadas)`,
              paletteFallback: warnings.some((w) => w.includes('paleta del proyecto')),
            },
            warnings,
            error: null,
            validationErrors: [],
            progress: null,
          },
        });
        toast(
          warnings.length > 0
            ? `Sprite generado por bloques con ${warnings.length} aviso(s).`
            : `Sprite generado por bloques (${planTiles(doc.width, doc.height, Math.max(4, settings.tileSize)).length} bloques).`,
          warnings.length > 0 ? 'info' : 'success',
        );
        return;
      }

      if (ai.mode === 'pipeline') {
        const { result, paletteFallback, raw, repairs } = await runPipeline(
          settings,
          prompt,
          doc,
          controller.signal,
        );
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'ok',
            preview: { result, mode: ai.mode, prompt, raw, paletteFallback },
            warnings: repairs,
            error: null,
            validationErrors: [],
            progress: null,
          },
        });
        toast('Sprite generado con éxito mediante pipeline multi-etapa.', 'success');
        return;
      }

      const { result, paletteFallback, raw, repairs } = await runSingleShot(
        settings,
        ai.mode,
        prompt,
        doc,
        controller.signal,
      );
      dispatch({
        type: 'ai/patch',
        patch: {
          status: 'ok',
          preview: { result, mode: ai.mode, prompt, raw, paletteFallback },
          warnings: repairs,
          error: null,
          validationErrors: [],
          progress: null,
        },
      });
      if (paletteFallback) {
        toast(
          'La paleta devuelta por la IA no era válida: se usa la paleta del proyecto con las matrices generadas.',
          'info',
        );
      } else {
        toast('Resultado de la IA recibido y validado.', 'success');
      }
    } catch (e) {
      const rawToRescue = e instanceof AiError && e.rawText ? e.rawText : lastPartialTextRef.current;
      const rescued = rawToRescue ? extractPartialAiResult(rawToRescue, doc.width, doc.height, doc.palette) : null;
      const hasRescuedRows = rescued !== null && rescued.completedRows > 0;

      if (e instanceof AiValidationError) {
        if (hasRescuedRows && rescued) {
          dispatch({
            type: 'ai/patch',
            patch: {
              status: 'error',
              validationErrors: e.errors,
              error: `La respuesta final no superó la validación, pero se rescataron ${rescued.completedRows}/${doc.height} filas generadas.`,
              preview: {
                result: rescued.result,
                mode: ai.mode,
                prompt,
                raw: rawToRescue,
                paletteFallback: true,
              },
              warnings: [`Generación incompleta rescatada: se conservaron ${rescued.completedRows}/${doc.height} filas.`],
              progress: null,
            },
          });
          toast(`Validación fallida: se rescataron ${rescued.completedRows}/${doc.height} filas.`, 'info');
          return;
        }
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'error',
            validationErrors: e.errors,
            error: 'La respuesta no superó la validación.',
            progress: null,
          },
        });
        toast('La IA devolvió un resultado inválido. Revisa los detalles del panel.', 'error');
        return;
      }
      const err = e as AiError;
      if (err.name === 'AbortError') {
        if (hasRescuedRows && rescued) {
          dispatch({
            type: 'ai/patch',
            patch: {
              status: 'idle',
              preview: {
                result: rescued.result,
                mode: ai.mode,
                prompt,
                raw: rawToRescue,
                paletteFallback: false,
              },
              warnings: [`Generación cancelada por el usuario: se conservaron ${rescued.completedRows}/${doc.height} filas generadas.`],
              progress: null,
            },
          });
          toast(`Generación cancelada: se conservaron ${rescued.completedRows}/${doc.height} filas.`, 'info');
          return;
        }
        dispatch({ type: 'ai/patch', patch: { status: 'idle', progress: null } });
        toast('Generación cancelada.', 'info');
        return;
      }
      const message = describeAiError(e);
      if (hasRescuedRows && rescued) {
        dispatch({
          type: 'ai/patch',
          patch: {
            status: 'error',
            error: message,
            preview: {
              result: rescued.result,
              mode: ai.mode,
              prompt,
              raw: rawToRescue,
              paletteFallback: false,
            },
            warnings: [`Generación incompleta rescatada: se conservaron ${rescued.completedRows}/${doc.height} filas antes del corte.`],
            progress: null,
          },
        });
        toast(`Error al generar (se rescataron ${rescued.completedRows}/${doc.height} filas).`, 'info');
        return;
      }
      dispatch({ type: 'ai/patch', patch: { status: 'error', error: message, progress: null } });
      toast(`Error al generar: ${message}`, 'error');
    }
  }, [dispatch, stateRef, toast, reportProgress]);

  /** Cancela la generación en curso. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const applyToSelection = useCallback(() => {
    const preview = stateRef.current.ai.preview;
    const doc = stateRef.current.history.present;
    if (!preview || preview.result.layers.length === 0) {
      toast('No hay resultado de inpainting para aplicar.', 'error');
      return;
    }
    const rect = preview.selectionRect ?? stateRef.current.selection;
    if (!rect) {
      toast('No se encontró la región de selección para aplicar el inpainting.', 'error');
      return;
    }
    const activeLayerId = stateRef.current.activeLayerId;
    const activeLayer = doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[0];
    if (!activeLayer) return;

    const newMatrix = cloneMatrix(activeLayer.matrix);
    const subMatrix = fromRows(preview.result.layers[0].matrix, rect.w, rect.h);
    blitMatrix(newMatrix, doc.width, doc.height, subMatrix, rect.w, rect.h, rect.x, rect.y, false);

    const updatedLayers = doc.layers.map((l) => (l.id === activeLayer.id ? { ...l, matrix: newMatrix } : l));
    const nextDoc: ProjectDoc = { ...doc, layers: updatedLayers };

    dispatch({ type: 'doc/commit', doc: nextDoc, label: 'aplicar inpainting' });
    dispatch({ type: 'ai/patch', patch: { preview: null } });
    toast(`Inpainting aplicado en la selección (${rect.w}×${rect.h} en ${rect.x},${rect.y}).`, 'success');
  }, [dispatch, stateRef, toast]);

  const applyFull = useCallback(() => {
    const preview = stateRef.current.ai.preview;
    if (!preview) return;
    if (preview.mode === 'inpaint' && (preview.selectionRect || stateRef.current.selection)) {
      applyToSelection();
      return;
    }
    const doc = aiResultToDoc(preview.result);
    if (doc.layers.length === 0) {
      toast('El resultado no contiene capas para aplicar.', 'error');
      return;
    }
    dispatch({ type: 'doc/commit', doc, label: 'aplicar resultado IA' });
    dispatch({ type: 'ai/patch', patch: { preview: null } });
    toast(`Lienzo sustituido por el resultado (${doc.width}x${doc.height}, ${doc.layers.length} capa(s)).`, 'success');
  }, [applyToSelection, dispatch, stateRef, toast]);

  const applyPaletteOnly = useCallback(() => {
    const preview = stateRef.current.ai.preview;
    if (!preview || preview.result.palette.length === 0) {
      toast('El resultado no contiene paleta.', 'error');
      return;
    }
    const colors = preview.result.palette
      .map((hex) => parseHexColor(hex))
      .filter((c): c is NonNullable<typeof c> => c !== null);
    dispatch({ type: 'palette/import', colors, mode: 'replace' });
    toast(`Paleta aplicada (${colors.length} colores).`, 'success');
  }, [dispatch, stateRef, toast]);

  const applyAsLayers = useCallback(() => {
    const stateNow = stateRef.current;
    const preview = stateNow.ai.preview;
    const current = stateNow.history.present;
    if (!preview || preview.result.layers.length === 0) {
      toast('El resultado no contiene capas.', 'error');
      return;
    }
    if (preview.result.width !== current.width || preview.result.height !== current.height) {
      toast(
        `El resultado es de ${preview.result.width}x${preview.result.height} y el lienzo de ${current.width}x${current.height}. Aplica el resultado completo o ajusta el tamaño.`,
        'error',
      );
      return;
    }
    const newLayers = preview.result.layers.map((payload, index) => {
      const base = createLayer(current.width, current.height, payload.name || `IA ${index + 1}`);
      return {
        ...base,
        visible: payload.visible !== false,
        matrix: fromRows(payload.matrix, current.width, current.height),
      };
    });
    if (current.layers.length + newLayers.length > LIMITS.maxLayers) {
      toast(`Se superaría el máximo de ${LIMITS.maxLayers} capas.`, 'error');
      return;
    }
    dispatch({
      type: 'doc/commit',
      doc: { ...current, layers: [...current.layers, ...newLayers] },
      label: 'añadir capas IA',
    });
    toast(`${newLayers.length} capa(s) añadidas al lienzo.`, 'success');
  }, [dispatch, stateRef, toast]);

  const discard = useCallback(() => {
    dispatch({ type: 'ai/patch', patch: { preview: null, validationErrors: [], error: null, status: 'idle', warnings: [] } });
    toast('Resultado descartado.', 'info');
  }, [dispatch, toast]);

  return { testConnection, generate, cancel, applyFull, applyPaletteOnly, applyAsLayers, applyToSelection, discard };
}
