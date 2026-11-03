/**
 * Prueba manual de la integración con IA local (Ollama real).
 * No forma parte de `npm test` porque requiere un servidor Ollama en marcha.
 *
 * Ejecutar con: npm run test:ai
 *
 * Prueba primero `qwen2.5-coder:1.5b` y, si la respuesta no supera la
 * validación estricta, reintenta con `qwen3.5:4b`.
 */
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/ai/prompts.ts';
import { generateRaw, listModels, describeAiError } from '../src/ai/client.ts';
import { parseAiResponse } from '../src/ai/schema.ts';
import type { AiSettings } from '../src/types/index.ts';

const settings: AiSettings = {
  provider: 'ollama',
  baseUrl: process.env.OLLAMA_URL ?? 'http://localhost:11434',
  model: '',
  apiKey: '',
  temperature: 0.2,
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 240000),
  maxTokens: 8192,
  tileSize: 8,
  reasoning: 'off',
};

const MODELS = (process.env.OLLAMA_MODELS ?? 'qwen2.5-coder:1.5b,qwen3.5:4b').split(',');

async function tryModel(model: string): Promise<boolean> {
  const prompt = buildUserPrompt({
    mode: 'full',
    description: 'una espada sencilla de 8x8 píxeles con empuñadura marrón y hoja gris',
    width: 8,
    height: 8,
    maxLayers: 2,
  });
  console.log(`\n--- Probando modelo: ${model} ---`);
  try {
    const { text: raw, elapsedMs } = await generateRaw(
      { ...settings, model },
      { system: SYSTEM_PROMPT, user: prompt, mode: 'full' },
    );
    const elapsed = (elapsedMs / 1000).toFixed(1);
    console.log(`Respuesta recibida en ${elapsed}s (${raw.length} caracteres).`);
    const parsed = parseAiResponse(raw, 'full');
    if (!parsed.ok) {
      console.log('VALIDACIÓN FALLIDA:');
      for (const err of parsed.errors.slice(0, 5)) console.log(`  - ${err}`);
      console.log('Inicio de la respuesta cruda:', raw.slice(0, 220).replace(/\n/g, ' '));
      return false;
    }
    const result = parsed.value;
    console.log(`OK: ${result.width}x${result.height}, ${result.palette.length} colores, ${result.layers.length} capa(s).`);
    console.log('Paleta:', result.palette.join(' '));
    for (const layer of result.layers) {
      console.log(`Capa "${layer.name}":`);
      for (const row of layer.matrix) {
        console.log('  ' + row.map((v) => (v < 0 ? '.' : String(v))).join(' '));
      }
    }
    return true;
  } catch (e) {
    console.log(`ERROR: ${describeAiError(e)}`);
    return false;
  }
}

async function main(): Promise<void> {
  console.log('Listando modelos disponibles…');
  try {
    const models = await listModels(settings);
    console.log('Modelos:', models.join(', ') || '(ninguno)');
  } catch (e) {
    console.log('No se pudo conectar con Ollama:', describeAiError(e));
    process.exitCode = 1;
    return;
  }

  for (const model of MODELS) {
    const ok = await tryModel(model.trim());
    if (ok) {
      console.log(`\nIntegración verificada con el modelo ${model.trim()}.`);
      return;
    }
    console.log(`El modelo ${model.trim()} no superó la validación; se prueba el siguiente…`);
  }
  console.log('\nNingún modelo superó la validación estricta.');
  process.exitCode = 1;
}

await main();
