/**
 * Prueba manual de la generación POR BLOQUES contra Ollama real.
 * Genera un sprite de 32x32 (4 bloques de 16x16) y muestra el resultado.
 *
 * Ejecutar con: npm run test:ai:tiles
 */
import { SYSTEM_PROMPT } from '../src/ai/prompts.ts';
import { generateRaw, describeAiError } from '../src/ai/client.ts';
import { extractJson, parseAiResponseNormalized } from '../src/ai/schema.ts';
import type { AiSettings } from '../src/types/index.ts';
import {
  buildPlanPrompt,
  buildTilePrompt,
  createEmptyGrid,
  extractTileContext,
  isDegenerateMatrix,
  mergeTileMatrix,
  planTiles,
} from '../src/ai/tiles.ts';

const settings: AiSettings = {
  provider: 'ollama',
  baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  model: process.env.OLLAMA_MODEL ?? 'qwen2.5-coder:1.5b',
  apiKey: '',
  temperature: 0.3,
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 240000),
  maxTokens: 4096,
  tileSize: Number(process.env.TILE_SIZE ?? 8),
  reasoning: 'off',
};

const CANVAS = 32;

async function main(): Promise<void> {
  const plan = planTiles(CANVAS, CANVAS, Number(process.env.TILE_SIZE ?? 8));
  const merged = createEmptyGrid(CANVAS, CANVAS);
  let palette: string[] = [];
  console.log(`Generando ${CANVAS}x${CANVAS} por bloques (${plan.length} llamadas) con ${settings.model}…`);

  // Fase 1: plan espacial común.
  let planText = '';
  try {
    const { text } = await generateRaw(settings, {
      system: SYSTEM_PROMPT,
      user: buildPlanPrompt('una espada sencilla con empuñadura marrón y hoja azul plateada', CANVAS, CANVAS),
      mode: 'palette',
    });
    const extracted = extractJson(text);
    const value = extracted.ok ? (extracted.value as { plan?: unknown }).plan : undefined;
    if (typeof value === 'string') planText = value.trim().slice(0, 600);
    console.log(`Plan: ${planText || '(no disponible)'}`);
  } catch (e) {
    console.log(`Plan no disponible: ${describeAiError(e)}`);
  }

  for (const tile of plan) {
    const context = extractTileContext(merged, tile);
    for (let attempt = 0; attempt < 2; attempt++) {
      const user = buildTilePrompt({
        description: 'una espada sencilla con empuñadura marrón y hoja azul plateada',
        tile,
        canvasWidth: CANVAS,
        canvasHeight: CANVAS,
        palette: palette.length > 0 ? palette : undefined,
        context,
        plan: planText || undefined,
        reinforce: attempt > 0,
      });
      const started = Date.now();
      try {
        const { text } = await generateRaw(settings, {
          system: SYSTEM_PROMPT,
          user,
          mode: tile.index === 0 ? 'full' : 'matrix',
        });
        const parsed = parseAiResponseNormalized(text, tile.index === 0 ? 'full' : 'matrix', palette.length || undefined);
        if (!parsed.ok || parsed.value.result.layers.length === 0) {
          console.log(`  Bloque ${tile.index + 1}/${plan.length} (${tile.x},${tile.y}) DESCARTADO: ${parsed.ok ? 'sin capas' : parsed.errors[0]}`);
          if (attempt === 0) continue;
          break;
        }
        for (const r of parsed.value.repairs) console.log(`    reparación: ${r}`);
        const matrix = parsed.value.result.layers[0].matrix;
        if (isDegenerateMatrix(matrix)) {
          console.log(`  Bloque ${tile.index + 1}/${plan.length} (${tile.x},${tile.y}) PLANO (intento ${attempt + 1})`);
          if (attempt === 0) continue;
        }
        if (palette.length === 0) palette = parsed.value.result.palette;
        mergeTileMatrix(merged, tile, matrix);
        console.log(
          `  Bloque ${tile.index + 1}/${plan.length} (${tile.x},${tile.y}) OK en ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        break;
      } catch (e) {
        console.log(`  Bloque ${tile.index + 1}/${plan.length} ERROR: ${describeAiError(e)}`);
        break;
      }
    }
  }

  console.log(`\nPaleta: ${palette.join(' ') || '(ninguna)'}`);
  console.log('Resultado fusionado:');
  for (const row of merged) {
    console.log('  ' + row.map((v) => (v < 0 ? '.' : String(v))).join(' '));
  }
  const painted = merged.flat().filter((v) => v >= 0).length;
  console.log(`\nPíxeles pintados: ${painted}/${CANVAS * CANVAS}`);
}

await main();
