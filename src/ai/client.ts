/**
 * Cliente de IA local con dos adaptadores:
 *  - `ollama`: API nativa de Ollama (`/api/tags`, `/api/chat` con `format: "json"`).
 *  - `openai`: APIs compatibles con OpenAI (`/models`, `/chat/completions`).
 *
 * Sin dependencias: `fetch` con `AbortController` para timeouts.
 * Los errores se traducen a mensajes comprensibles para la interfaz.
 */
import type { AiMode, AiSettings } from '../types/index.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiRequestOptions {
  system: string;
  user: string;
  mode: AiMode;
  signal?: AbortSignal;
  schema?: Record<string, unknown>;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** URL del endpoint de chat según el proveedor. */
export function chatEndpoint(settings: AiSettings): string {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (settings.provider === 'ollama') return `${base}/api/chat`;
  // Los servidores OpenAI suelen exponer el prefijo /v1.
  return /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function modelsEndpoint(settings: AiSettings): string {
  const base = normalizeBaseUrl(settings.baseUrl);
  if (settings.provider === 'ollama') return `${base}/api/tags`;
  return /\/v\d+$/.test(base) ? `${base}/models` : `${base}/v1/models`;
}

function headers(settings: AiSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey.trim()) h.Authorization = `Bearer ${settings.apiKey.trim()}`;
  return h;
}

export class AiError extends Error {
  kind: 'network' | 'timeout' | 'server' | 'format';
  rawText?: string;
  constructor(kind: AiError['kind'], message: string, rawText?: string) {
    super(message);
    this.kind = kind;
    this.name = 'AiError';
    this.rawText = rawText;
  }
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, mode: 'cors' });
    return res;
  } catch (e) {
    const err = e as Error;
    // Cancelación explícita del usuario: se propaga como AbortError.
    if (external?.aborted) {
      throw new DOMException('Generación cancelada', 'AbortError');
    }
    if (err.name === 'TimeoutError' || controller.signal.aborted) {
      throw new AiError('timeout', `La petición superó el tiempo límite (${Math.round(timeoutMs / 1000)} s). Puedes aumentar el timeout en el panel, cancelar y reintentar, o reducir el tamaño del lienzo.`);
    }
    throw new AiError(
      'network',
      'No se pudo conectar con el servidor. Comprueba la URL, que el servidor esté en marcha y que permita CORS (en Ollama: OLLAMA_ORIGINS).',
    );
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

async function readError(res: Response, provider: AiSettings['provider']): Promise<never> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const errObj = (data.error ?? data) as Record<string, unknown>;
      detail = String(errObj.message ?? errObj.error ?? text).slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  } catch {
    /* sin cuerpo */
  }
  const hints: Record<number, string> = {
    404: provider === 'ollama' ? 'Endpoint no encontrado: ¿la URL base es la del servidor Ollama?' : 'Endpoint no encontrado: ¿la URL base incluye /v1?',
    401: 'Credenciales no válidas: revisa la API key.',
    4040: '',
  };
  const hint = hints[res.status] ?? '';
  throw new AiError('server', `El servidor respondió ${res.status} ${res.statusText}. ${detail} ${hint}`.trim());
}

/** Comprueba la conexión y devuelve la lista de modelos disponibles. */
export async function listModels(settings: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const res = await request(modelsEndpoint(settings), { method: 'GET', headers: headers(settings) }, settings.timeoutMs, signal);
  if (!res.ok) await readError(res, settings.provider);
  const data = (await res.json()) as Record<string, unknown>;
  if (settings.provider === 'ollama') {
    const models = Array.isArray(data.models) ? (data.models as Array<Record<string, unknown>>) : [];
    return models.map((m) => String(m.name ?? m.model ?? '')).filter(Boolean);
  }
  const models = Array.isArray(data.data) ? (data.data as Array<Record<string, unknown>>) : [];
  return models.map((m) => String(m.id ?? m.name ?? '')).filter(Boolean);
}

export async function testConnection(settings: AiSettings, signal?: AbortSignal): Promise<{ models: string[] }> {
  const models = await listModels(settings, signal);
  return { models };
}

/**
 * Cuerpo de la petición de chat según el proveedor.
 * Se extrae como función pura para poder testearlo (los modelos "thinking"
 * como Qwen3 necesitan `think: false` para responder JSON ágilmente).
 */
export function buildChatBody(
  settings: AiSettings,
  messages: ChatMessage[],
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (settings.provider === 'ollama') {
    const options: Record<string, unknown> = { temperature: settings.temperature };
    if (settings.maxTokens > 0) options.num_predict = settings.maxTokens;
    const body: Record<string, unknown> = {
      model: settings.model,
      messages,
      stream: true,
      format: schema ?? 'json',
      options,
    };
    if (settings.reasoning === 'off') body.think = false;
    else if (settings.reasoning === 'on') body.think = true;
    return body;
  }
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: settings.temperature,
    stream: true,
    response_format: schema
      ? { type: 'json_schema', json_schema: { name: 'pixel_art', strict: false, schema } }
      : { type: 'json_object' },
  };
  if (settings.maxTokens > 0) body.max_tokens = settings.maxTokens;
  return body;
}

export interface StreamProgress {
  chars: number;
  chunks: number;
  finishReason?: string | null;
  reasoningChars?: number;
  partialText?: string;
}

/** Resultado de leer un stream del modelo. */
export interface StreamResult {
  text: string;
  /** Motivo de finalización (`stop`, `length`, …) o null si no se informó. */
  finishReason: string | null;
  /** Caracteres de "razonamiento" recibidos (campos thinking/reasoning). */
  reasoningChars: number;
}

/**
 * Lee una respuesta en streaming (NDJSON de Ollama o SSE de OpenAI) y
 * devuelve el texto acumulado junto con metadatos. Tolera líneas parciales,
 * respuestas no streaming (JSON completo) y campos de razonamiento.
 */
export async function readStream(
  res: Response,
  onProgress?: (progress: StreamProgress) => void,
): Promise<StreamResult> {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    onProgress?.({ chars: text.length, chunks: 1, partialText: text });
    return { text, finishReason: null, reasoningChars: 0 };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let chunks = 0;
  let finishReason: string | null = null;
  let reasoningChars = 0;

  const consume = (line: string): void => {
    const parsed = parseStreamLine(line);
    if (parsed.content) {
      full += parsed.content;
      chunks += 1;
    }
    if (parsed.reasoning) reasoningChars += parsed.reasoning.length;
    if (parsed.finishReason) finishReason = parsed.finishReason;
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) consume(line);
    onProgress?.({ chars: full.length, chunks, finishReason, reasoningChars, partialText: full });
  }
  buffer += decoder.decode();
  for (const line of buffer.split('\n')) consume(line);
  onProgress?.({ chars: full.length, chunks, finishReason, reasoningChars, partialText: full });
  return { text: full, finishReason, reasoningChars };
}

/** Extrae contenido, razonamiento y motivo de fin de una línea de stream. */
function parseStreamLine(line: string): {
  content: string;
  reasoning: string;
  finishReason: string | null;
} {
  const empty = { content: '', reasoning: '', finishReason: null };
  const trimmed = line.trim();
  if (!trimmed) return empty;
  const payload = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!payload || payload === '[DONE]') return empty;
  try {
    const obj = JSON.parse(payload) as {
      message?: { content?: string; reasoning_content?: string; thinking?: string };
      response?: string;
      done_reason?: string;
      choices?: Array<{
        delta?: { content?: string; reasoning_content?: string; thinking?: string };
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string;
      }>;
    };
    const choice = obj.choices?.[0];
    const content = obj.message?.content ?? choice?.delta?.content ?? choice?.message?.content ?? obj.response ?? '';
    const reasoning =
      obj.message?.reasoning_content ??
      obj.message?.thinking ??
      choice?.delta?.reasoning_content ??
      choice?.delta?.thinking ??
      '';
    const finishReason = obj.done_reason ?? choice?.finish_reason ?? null;
    return { content, reasoning, finishReason };
  } catch {
    return empty;
  }
}

export interface GenerateProgress {
  chars: number;
  elapsedMs: number;
  stage?: string;
  partialText?: string;
}

export interface GenerateResult extends StreamResult {
  elapsedMs: number;
}

/**
 * Genera una respuesta JSON del modelo con streaming.
 * Devuelve el texto crudo con metadatos: el parseo/validación ocurre en
 * `ai/schema.ts`. Lanza errores específicos para respuestas vacías o cortadas.
 */
export async function generateRaw(
  settings: AiSettings,
  options: AiRequestOptions & { onProgress?: (progress: GenerateProgress) => void },
): Promise<GenerateResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: options.system },
    { role: 'user', content: options.user },
  ];
  const provider = settings.provider;
  const started = Date.now();

  const res = await request(
    chatEndpoint(settings),
    {
      method: 'POST',
      headers: headers(settings),
      body: JSON.stringify(buildChatBody(settings, messages, options.schema)),
    },
    settings.timeoutMs,
    options.signal,
  );
  if (!res.ok) await readError(res, provider);

  const result = await readStream(res, (progress) => {
    options.onProgress?.({
      chars: progress.chars,
      elapsedMs: Date.now() - started,
      partialText: progress.partialText,
    });
  });

  const text = result.text;
  if (!text.trim()) {
    if (result.reasoningChars > 0) {
      throw new AiError(
        'format',
        'El modelo devolvió solo texto de razonamiento y ningún contenido. Desactiva el razonamiento del modelo o sube el límite de tokens.',
      );
    }
    if (result.finishReason === 'length') {
      throw new AiError(
        'format',
        'La respuesta se cortó al alcanzar el límite de tokens sin generar contenido. Sube el límite de tokens o usa un lienzo más pequeño.',
      );
    }
    throw new AiError('format', 'El modelo devolvió una respuesta vacía.');
  }

  // Respuesta truncada por límite de tokens: el JSON no llega a cerrarse.
  const looksComplete = /\}\s*$/.test(text.trim());
  if (result.finishReason === 'length' && !looksComplete) {
    throw new AiError(
      'format',
      `La respuesta se cortó al alcanzar el límite de tokens (${settings.maxTokens}) y el JSON quedó incompleto. ` +
        'Si se generaron filas previas, han sido rescatadas para que puedas aprovecharlas o editarlas. ' +
        'Sugerencia: activa el modo Pipeline, usa el formato ASCII Grid o genera por bloques (8×8).',
      text,
    );
  }

  return { ...result, elapsedMs: Date.now() - started };
}

/** Mensaje amigable para errores desconocidos. */
export function describeAiError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Error desconocido al comunicarse con la IA.';
}
