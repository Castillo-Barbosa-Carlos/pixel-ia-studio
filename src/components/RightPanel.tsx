/**
 * Panel derecho: herramientas de edición, atributos rápidos, capas y minimapa.
 */
import { useState } from 'react';
import { useEditor } from '../state/editorStore.tsx';
import { TOOLS, toolById } from '../tools/index.ts';
import { Icon } from './Icons.tsx';
import { Minimap } from '../canvas/Minimap.tsx';

function ToolGrid(): JSX.Element {
  const { state, dispatch } = useEditor();
  const active = toolById(state.tool);
  return (
    <section className="panel__section">
      <h3 className="panel__heading">Herramientas</h3>
      <div className="toolgrid" data-testid="tool-grid">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`tool ${state.tool === tool.id ? 'tool--active' : ''}`}
            title={`${tool.label} (${tool.shortcut}) — ${tool.hint}`}
            onClick={() => dispatch({ type: 'tool/set', tool: tool.id })}
            data-testid={`tool-${tool.id}`}
          >
            <Icon name={tool.icon} size={18} />
            <span className="tool__label">{tool.label}</span>
            <span className="tool__key">{tool.shortcut}</span>
          </button>
        ))}
      </div>
      <p className="panel__hint" data-testid="tool-hint">{active.hint}</p>
    </section>
  );
}

function ToolOptions(): JSX.Element {
  const { state, dispatch } = useEditor();
  const options = state.toolOptions;
  return (
    <section className="panel__section">
      <h3 className="panel__heading">Atributos</h3>
      <label className="field">
        <span>Tamaño de pincel</span>
        <input
          type="range"
          min={1}
          max={16}
          value={options.brushSize}
          onChange={(e) => dispatch({ type: 'tool/options', patch: { brushSize: Number(e.target.value) } })}
        />
        <b>{options.brushSize}</b>
      </label>
      <label className="field">
        <span>Grosor de trazo</span>
        <input
          type="range"
          min={1}
          max={8}
          value={options.outlineWidth}
          onChange={(e) => dispatch({ type: 'tool/options', patch: { outlineWidth: Number(e.target.value) } })}
        />
        <b>{options.outlineWidth}</b>
      </label>
      <label className="field field--inline">
        <input
          type="checkbox"
          checked={options.shapeFilled}
          onChange={(e) => dispatch({ type: 'tool/options', patch: { shapeFilled: e.target.checked } })}
        />
        <span>Figuras rellenas</span>
      </label>
      <label className="field">
        <span>Tolerancia de relleno</span>
        <input
          type="range"
          min={0}
          max={64}
          value={options.fillTolerance}
          onChange={(e) => dispatch({ type: 'tool/options', patch: { fillTolerance: Number(e.target.value) } })}
        />
        <b>{options.fillTolerance}</b>
      </label>
    </section>
  );
}

function LayersPanel(): JSX.Element {
  const { state, dispatch } = useEditor();
  const doc = state.history.present;
  const [editingId, setEditingId] = useState<string | null>(null);
  const activeLayer = doc.layers.find((l) => l.id === state.activeLayerId);
  // La lista se muestra con la capa superior primero (como en editores gráficos).
  const ordered = [...doc.layers].reverse();

  return (
    <section className="panel__section" data-testid="layers-panel">
      <h3 className="panel__heading">
        Capas
        <span className="panel__heading-actions">
          <button
            type="button"
            className="btn btn--icon btn--tiny"
            title="Añadir capa"
            onClick={() => dispatch({ type: 'layers/add' })}
            data-testid="layer-add"
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            type="button"
            className="btn btn--icon btn--tiny"
            title="Duplicar capa activa"
            onClick={() => dispatch({ type: 'layers/duplicate', id: state.activeLayerId })}
            data-testid="layer-duplicate"
          >
            <Icon name="duplicate" size={13} />
          </button>
          <button
            type="button"
            className="btn btn--icon btn--tiny"
            title="Eliminar capa activa"
            onClick={() => dispatch({ type: 'layers/remove', id: state.activeLayerId })}
            disabled={doc.layers.length <= 1}
            data-testid="layer-delete"
          >
            <Icon name="trash" size={13} />
          </button>
        </span>
      </h3>

      <ul className="layers" data-testid="layers-list">
        {ordered.map((layer) => {
          const index = doc.layers.findIndex((l) => l.id === layer.id);
          return (
            <li
              key={layer.id}
              className={`layer ${layer.id === state.activeLayerId ? 'layer--active' : ''} ${
                layer.visible ? '' : 'layer--hidden'
              }`}
              onClick={() => dispatch({ type: 'layers/select', id: layer.id })}
              data-testid={`layer-${index}`}
            >
              <button
                type="button"
                className="layer__icon"
                title={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'layers/visibility', id: layer.id });
                }}
                data-testid={`layer-visibility-${index}`}
              >
                <Icon name={layer.visible ? 'eye' : 'eye-off'} size={13} />
              </button>
              {editingId === layer.id ? (
                <input
                  className="layer__name-input"
                  autoFocus
                  defaultValue={layer.name}
                  onBlur={(e) => {
                    dispatch({ type: 'layers/rename', id: layer.id, name: e.target.value });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className="layer__name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(layer.id);
                  }}
                  title="Doble clic para renombrar"
                >
                  {layer.name}
                </span>
              )}
              <button
                type="button"
                className="layer__icon"
                title={layer.locked ? 'Desbloquear capa' : 'Bloquear capa'}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'layers/lock', id: layer.id });
                }}
                data-testid={`layer-lock-${index}`}
              >
                <Icon name={layer.locked ? 'lock' : 'unlock'} size={13} />
              </button>
              <span className="layer__order">
                <button
                  type="button"
                  className="layer__icon"
                  title="Subir capa"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'layers/move', id: layer.id, direction: 1 });
                  }}
                  data-testid={`layer-up-${index}`}
                >
                  <Icon name="up" size={11} />
                </button>
                <button
                  type="button"
                  className="layer__icon"
                  title="Bajar capa"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: 'layers/move', id: layer.id, direction: -1 });
                  }}
                  data-testid={`layer-down-${index}`}
                >
                  <Icon name="down" size={11} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      {activeLayer ? (
        <label className="field">
          <span>Opacidad de "{activeLayer.name}"</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(activeLayer.opacity * 100)}
            onChange={(e) =>
              dispatch({ type: 'layers/opacity', id: activeLayer.id, opacity: Number(e.target.value) / 100 })
            }
            data-testid="layer-opacity"
          />
          <b>{Math.round(activeLayer.opacity * 100)}%</b>
        </label>
      ) : null}
    </section>
  );
}

export function RightPanel(): JSX.Element {
  return (
    <aside className="panel panel--right" data-testid="right-panel">
      <section className="panel__section">
        <h3 className="panel__heading">Minimapa</h3>
        <Minimap />
        <p className="panel__hint">Refleja el compuesto de las capas visibles. Clic para desplazar la vista.</p>
      </section>
      <ToolGrid />
      <ToolOptions />
      <LayersPanel />
    </aside>
  );
}
