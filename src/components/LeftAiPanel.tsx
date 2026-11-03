/**
 * Panel izquierdo: configuración de la conexión con IA local, generación de
 * paletas/matrices, vista previa y aplicación de resultados.
 */
import { useEffect, useRef } from 'react';
import { drawAiPreview } from '../ai/preview.ts';
import { useAi } from '../ai/useAi.ts';
import { estimateTokens, needsTiling, planTiles } from '../ai/tiles.ts';
import { needsRescaling, computeBaseSize } from '../ai/rescale.ts';
import { useEditor } from '../state/editorStore.tsx';
import { parseHexColor } from '../core/color.ts';
import { Icon } from './Icons.tsx';
import type { AiMode, AiProvider, AiSettings } from '../types/index.ts';
import { exportAiResult } from '../utils/projectOps.ts';

const MODE_LABELS: Array<{ id: AiMode; label: string; hint: string }> = [
  { id: 'full', label: 'Paleta + matriz (directo)', hint: 'Genera la paleta y las capas de píxeles en una sola llamada.' },
  { id: 'pipeline', label: 'Pipeline multi-etapa (Paleta → Silueta → Detalle)', hint: 'Diseño progresivo en 3 etapas: mayor estabilidad y calidad.' },
  { id: 'inpaint', label: 'Inpainting (modificar selección)', hint: 'Modifica únicamente el área seleccionada con la herramienta Selección (S).' },
  { id: 'palette', label: 'Solo paleta', hint: 'Genera únicamente una paleta de colores.' },
  { id: 'matrix', label: 'Solo matriz', hint: 'Genera matrices usando la paleta actual del proyecto.' },
];

export function LeftAiPanel(): JSX.Element {
  const { state, dispatch, toast } = useEditor();
  const ai = state.ai;
  const doc = state.history.present;
  const { testConnection, generate, cancel, applyFull, applyPaletteOnly, applyAsLayers, applyToSelection, discard } = useAi();
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !ai.preview) return;
    const maxSide = 220;
    const { width, height } = ai.preview.result;
    const scale = Math.max(2, Math.floor(Math.min(maxSide / width, maxSide / height)));
    drawAiPreview(canvas, ai.preview.result, scale);
  }, [ai.preview]);

  const busy = ai.status === 'generating' || ai.status === 'connecting';
  const hasPreview = ai.preview !== null;

  return (
    <aside className="panel panel--left" data-testid="ai-panel">
      <section className="panel__section">
        <h3 className="panel__heading">
          <Icon name="sparkles" size={14} /> Conexión con IA local
        </h3>

        <label className="field">
          <span>Proveedor</span>
          <select
            value={ai.settings.provider}
            onChange={(e) => {
              const provider = e.target.value as AiProvider;
              dispatch({ type: 'ai/settings', patch: { provider } });
            }}
            data-testid="ai-provider"
          >
            <option value="ollama">Ollama</option>
            <option value="openai">API compatible con OpenAI</option>
          </select>
        </label>

        <label className="field">
          <span>URL del servidor</span>
          <input
            type="text"
            value={ai.settings.baseUrl}
            placeholder="http://localhost:11434"
            onChange={(e) => dispatch({ type: 'ai/settings', patch: { baseUrl: e.target.value } })}
            data-testid="ai-url"
          />
        </label>

        <label className="field">
          <span>Modelo</span>
          <input
            type="text"
            list="ai-models"
            value={ai.settings.model}
            placeholder="qwen2.5-coder:1.5b"
            onChange={(e) => dispatch({ type: 'ai/settings', patch: { model: e.target.value } })}
            data-testid="ai-model"
          />
          <datalist id="ai-models">
            {ai.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>

        {ai.settings.provider === 'openai' ? (
          <label className="field">
            <span>API key (opcional)</span>
            <input
              type="password"
              value={ai.settings.apiKey}
              placeholder="sk-..."
              onChange={(e) => dispatch({ type: 'ai/settings', patch: { apiKey: e.target.value } })}
              data-testid="ai-apikey"
            />
          </label>
        ) : null}

        <div className="field-row">
          <label className="field field--narrow">
            <span>Temperatura</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(ai.settings.temperature * 100)}
              onChange={(e) =>
                dispatch({ type: 'ai/settings', patch: { temperature: Number(e.target.value) / 100 } })
              }
            />
            <b>{ai.settings.temperature.toFixed(2)}</b>
          </label>
          <label className="field field--narrow">
            <span>Timeout (s)</span>
            <input
              type="number"
              min={10}
              max={600}
              value={Math.round(ai.settings.timeoutMs / 1000)}
              onChange={(e) =>
                dispatch({ type: 'ai/settings', patch: { timeoutMs: Math.max(10, Number(e.target.value)) * 1000 } })
              }
            />
          </label>
        </div>

        <label className="field">
          <span>Límite de tokens de salida</span>
          <input
            type="number"
            min={256}
            max={32768}
            step={256}
            value={ai.settings.maxTokens}
            onChange={(e) =>
              dispatch({ type: 'ai/settings', patch: { maxTokens: Math.max(256, Number(e.target.value)) } })
            }
            data-testid="ai-max-tokens"
          />
          <small>
            Corta generaciones que se alargan sin fin. La cuadrícula ASCII ahorra ~70% de tokens frente a matrices numéricas. Este lienzo necesita unos{' '}
            {estimateTokens(doc.width, doc.height, ai.mode === 'full' ? 2 : 1).toLocaleString('es')} tokens.
          </small>
        </label>

        <label className="field">
          <span>Razonamiento del modelo</span>
          <select
            value={ai.settings.reasoning}
            onChange={(e) =>
              dispatch({
                type: 'ai/settings',
                patch: { reasoning: e.target.value as AiSettings['reasoning'] },
              })
            }
            data-testid="ai-reasoning"
          >
            <option value="off">Desactivado (recomendado para JSON)</option>
            <option value="auto">Automático</option>
            <option value="on">Activado</option>
          </select>
          <small>
            Desactivar el modo "thinking" (Ollama) hace que modelos tipo Qwen3 respondan JSON mucho
            más rápido y con menos rodeos.
          </small>
        </label>

        <div className="btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => void testConnection()}
            disabled={busy}
            data-testid="ai-test"
          >
            <Icon name="refresh" /> Probar conexión
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void (async () => {
                await testConnection();
              })();
            }}
            disabled={busy}
            title="Detectar modelos disponibles en el servidor"
            data-testid="ai-detect-models"
          >
            <Icon name="settings" /> Detectar modelos
          </button>
        </div>

        <p className={`ai-status ai-status--${ai.status}`} data-testid="ai-connection">
          <span className="dot" />
          {ai.connectionInfo ?? (ai.status === 'connecting' ? 'Conectando…' : 'Sin probar')}
        </p>
      </section>

      <section className="panel__section">
        <h3 className="panel__heading">Generar con IA</h3>

        <label className="field">
          <span>Tipo de generación</span>
          <select
            value={ai.mode}
            onChange={(e) => dispatch({ type: 'ai/patch', patch: { mode: e.target.value as AiMode } })}
            data-testid="ai-mode"
          >
            {MODE_LABELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <small>{MODE_LABELS.find((m) => m.id === ai.mode)?.hint}</small>
        </label>

        <label className="field">
          <span>Descripción del sprite</span>
          <textarea
            rows={3}
            value={ai.prompt}
            placeholder="p. ej.: un cofre del tesoro de 16x16 con detalles dorados"
            onChange={(e) => dispatch({ type: 'ai/patch', patch: { prompt: e.target.value } })}
            data-testid="ai-prompt"
          />
        </label>

        {ai.mode === 'inpaint' ? (
          <div className="ai-tile-chip" data-testid="ai-inpaint-chip">
            <Icon name="select" size={14} />
            <div>
              {state.selection ? (
                <p>
                  <b>Inpainting activo:</b> Región de {state.selection.w}×{state.selection.h} en (x={state.selection.x}, y={state.selection.y}).
                  La IA solo modificará esta área, conservando intacto el resto del sprite.
                </p>
              ) : (
                <p style={{ color: 'var(--color-warning)' }}>
                  ⚠️ No hay ninguna selección activa. Usa la herramienta <b>Selección (S)</b> en la barra para delimitar la región que quieres modificar.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {needsRescaling(doc.width, doc.height) && ai.mode !== 'inpaint' && ai.mode !== 'palette' ? (
          <div className="ai-tile-chip" data-testid="ai-rescale-chip">
            <Icon name="sparkles" size={14} />
            <div>
              <p>
                <b>Generación piramidal activa ({doc.width}×{doc.height}):</b> Se generará una composición
                completa en baja resolución ({computeBaseSize(doc.width, doc.height).baseW}×{computeBaseSize(doc.width, doc.height).baseH})
                y se reescalará con suavizado de bordes para evitar costuras y deformaciones anatómicas.
              </p>
            </div>
          </div>
        ) : null}

        {ai.mode !== 'palette' && ai.mode !== 'inpaint' && !needsRescaling(doc.width, doc.height) && needsTiling(doc.width, doc.height) ? (
          <div className="ai-tile-chip" data-testid="ai-tile-chip">
            <Icon name="grid" size={12} />
            <div>
              <p>
                Generación por bloques de {ai.settings.tileSize}×{ai.settings.tileSize} (
                {planTiles(doc.width, doc.height, ai.settings.tileSize).length} llamadas). Los bloques
                se generan con un plan común y los bordes vecinos como referencia para que las
                costuras casen.
              </p>
              <label className="field field--inline" style={{ marginTop: 6 }}>
                <span>Tamaño de bloque</span>
                <select
                  value={ai.settings.tileSize}
                  onChange={(e) =>
                    dispatch({ type: 'ai/settings', patch: { tileSize: Number(e.target.value) } })
                  }
                  data-testid="ai-tile-size"
                >
                  <option value={8}>8×8 (más fiable en modelos pequeños)</option>
                  <option value={12}>12×12</option>
                  <option value={16}>16×16 (menos llamadas)</option>
                  <option value={24}>24×24</option>
                </select>
              </label>
            </div>
          </div>
        ) : null}

        <div className="btn-row">
          <button
            type="button"
            className="btn btn--accent"
            onClick={() => void generate()}
            disabled={busy}
            data-testid="ai-generate"
          >
            <Icon name="sparkles" /> {ai.status === 'generating' ? 'Generando…' : 'Generar'}
          </button>
          {ai.status === 'generating' ? (
            <button type="button" className="btn" onClick={cancel} data-testid="ai-cancel">
              <Icon name="x" /> Cancelar
            </button>
          ) : null}
          {hasPreview && ai.status !== 'generating' ? (
            <button type="button" className="btn" onClick={() => void generate()} disabled={busy} data-testid="ai-regenerate">
              <Icon name="refresh" /> Regenerar
            </button>
          ) : null}
        </div>

        {ai.status === 'generating' ? (
          <div className="ai-progress" data-testid="ai-progress">
            <span className="ai-progress__bar" />
            <span data-testid="ai-progress-text">
              {ai.progress?.stage ? `${ai.progress.stage} · ` : ''}Recibiendo respuesta…{' '}
              {Math.round((ai.progress?.elapsedMs ?? 0) / 1000)} s · {ai.progress?.chars ?? 0} caracteres
            </span>
          </div>
        ) : null}

        {doc.width * doc.height > 1024 ? (
          <p className="alert alert--error" data-testid="ai-big-canvas-hint">
            Lienzo de {doc.width}x{doc.height} píxeles: para lienzos grandes se recomienda la generación por bloques (16×16 u 8×8) o el Pipeline multi-etapa.
          </p>
        ) : null}

        {ai.error ? (
          <div className="alert alert--error" data-testid="ai-error">
            <b>Error:</b> {ai.error}
          </div>
        ) : null}

        {ai.validationErrors.length > 0 ? (
          <div className="alert alert--error" data-testid="ai-validation-errors">
            <b>La respuesta no es válida:</b>
            <ul>
              {ai.validationErrors.slice(0, 6).map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
            <p className="alert__hint">
              Puedes <b>Regenerar</b>: los modelos pequeños a veces devuelven la paleta como números
              o cambian el tamaño de las matrices. Si el error persiste, prueba el <b>Pipeline multi-etapa</b> o el modo <b>Solo matriz</b>.
            </p>
          </div>
        ) : null}
      </section>

      {hasPreview && ai.preview ? (
        <section
          className="panel__section"
          data-testid={ai.status === 'generating' ? 'ai-live-preview' : 'ai-preview'}
        >
          <h3 className="panel__heading">
            {ai.status === 'generating' ? 'Generando en vivo' : 'Vista previa'}
            <span className="panel__heading-actions">
              <button
                type="button"
                className="btn btn--icon btn--tiny"
                title="Descartar resultado"
                onClick={discard}
                disabled={ai.status === 'generating'}
                data-testid="ai-discard"
              >
                <Icon name="x" size={13} />
              </button>
            </span>
          </h3>

          <div className="ai-preview">
            <canvas ref={previewCanvasRef} data-testid="ai-preview-canvas" />
            <div className="ai-preview__meta">
              {ai.status === 'generating' ? (
                <p className="ai-preview__warning" style={{ borderColor: 'var(--color-primary)' }}>
                  ⚡ Previsualización en tiempo real
                </p>
              ) : null}
              {ai.preview.paletteFallback ? (
                <p className="ai-preview__warning" data-testid="ai-palette-fallback">
                  <Icon name="x" size={11} /> La paleta devuelta no era válida: se usa la paleta del
                  proyecto.
                </p>
              ) : null}
              {ai.warnings.length > 0 ? (
                <div className="ai-preview__warning" data-testid="ai-warnings">
                  <b>{ai.warnings.length} aviso(s):</b>
                  <ul>
                    {ai.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p>
                <b>
                  {ai.preview.result.width}x{ai.preview.result.height}
                </b>{' '}
                · {ai.preview.result.layers.length} capa(s) · {ai.preview.result.palette.length} colores
              </p>
              <div className="ai-preview__palette">
                {ai.preview.result.palette.slice(0, 32).map((hex, i) => {
                  const color = parseHexColor(hex);
                  return (
                    <span
                      key={`${hex}-${i}`}
                      className="mini-swatch"
                      style={{ background: color ? `rgba(${parseInt(color.hex.slice(1, 3), 16)}, ${parseInt(color.hex.slice(3, 5), 16)}, ${parseInt(color.hex.slice(5, 7), 16)}, ${color.alpha / 255})` : '#000' }}
                      title={hex}
                    />
                  );
                })}
              </div>
              <ul className="ai-preview__layers">
                {ai.preview.result.layers.map((layer, i) => (
                  <li key={`${layer.name}-${i}`}>
                    <Icon name={layer.visible ? 'eye' : 'eye-off'} size={11} /> {layer.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {ai.status !== 'generating' ? (
            <div className="btn-row">
              {ai.preview.mode === 'inpaint' ? (
                <button type="button" className="btn btn--accent" onClick={applyToSelection} data-testid="ai-apply">
                  <Icon name="check" /> Aplicar en la selección
                </button>
              ) : (
                <button type="button" className="btn btn--accent" onClick={applyFull} data-testid="ai-apply">
                  <Icon name="check" /> Aplicar al lienzo
                </button>
              )}
              <button
                type="button"
                className="btn"
                onClick={applyPaletteOnly}
                disabled={ai.preview.result.palette.length === 0}
                data-testid="ai-apply-palette"
              >
                Solo paleta
              </button>
              <button
                type="button"
                className="btn"
                onClick={applyAsLayers}
                disabled={ai.preview.result.layers.length === 0}
                data-testid="ai-apply-layers"
              >
                Añadir capas
              </button>
            </div>
          ) : null}

          <details className="ai-raw">
            <summary>JSON devuelto</summary>
            <pre>{ai.preview.raw.slice(0, 4000)}</pre>
            <button
              type="button"
              className="btn btn--tiny"
              onClick={() => {
                exportAiResult(ai.preview ? JSON.stringify(ai.preview.result, null, 2) : '{}', toast);
              }}
            >
              <Icon name="save" size={12} /> Exportar JSON
            </button>
          </details>
        </section>
      ) : null}

      <section className="panel__section">
        <h3 className="panel__heading">Formato esperado</h3>
        <p className="panel__hint">
          La IA responde JSON puro: <code>width</code>, <code>height</code>, <code>palette</code> (HEX) y{' '}
          <code>layers</code> con matrices de índices (<code>-1</code> = transparente). Documentado en{' '}
          <code>docs/AI-JSON-FORMAT.md</code>.
        </p>
      </section>
    </aside>
  );
}
