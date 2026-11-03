/**
 * Barra inferior: coordenadas, selección, herramienta activa con atributos,
 * zoom y estado del proyecto.
 */
import { useCursor } from '../state/cursorStore.ts';
import { useEditor } from '../state/editorStore.tsx';
import { toolById } from '../tools/index.ts';
import { Icon } from './Icons.tsx';

export function StatusBar(): JSX.Element {
  const cursor = useCursor();
  const { state, dispatch } = useEditor();
  const doc = state.history.present;
  const tool = toolById(state.tool);
  const options = state.toolOptions;
  const selection = state.selection;
  const aiStatus =
    state.ai.status === 'ok'
      ? 'IA lista'
      : state.ai.status === 'error'
        ? 'IA con error'
        : state.ai.status === 'generating'
          ? 'IA generando…'
          : state.ai.status === 'connecting'
            ? 'IA conectando…'
            : 'IA inactiva';

  return (
    <footer className="statusbar" data-testid="status-bar">
      <span className="statusbar__item" data-testid="status-coords">
        <Icon name="select" size={12} />
        X: <b>{cursor.inside ? cursor.x : '–'}</b> Y: <b>{cursor.inside ? cursor.y : '–'}</b>
      </span>

      <span className="statusbar__item" data-testid="status-selection">
        Selección:{' '}
        <b>
          {selection ? `${selection.w} x ${selection.h}` : '—'}
        </b>
        {selection ? ` @ ${selection.x},${selection.y}` : ''}
      </span>

      <span className="statusbar__item" data-testid="status-tool">
        <Icon name={tool.icon} size={12} />
        <b>{tool.label}</b>
        <span className="statusbar__attrs">
          {state.tool === 'pencil' || state.tool === 'pencil-eraser' || state.tool === 'eraser' || state.tool === 'shade' ? (
            <label className="statusbar__attr">
              Pincel
              <input
                type="range"
                min={1}
                max={16}
                value={options.brushSize}
                onChange={(e) => dispatch({ type: 'tool/options', patch: { brushSize: Number(e.target.value) } })}
                data-testid="brush-size"
              />
              <b>{options.brushSize}px</b>
            </label>
          ) : null}
          {state.tool === 'rect' || state.tool === 'ellipse' ? (
            <>
              <label className="statusbar__attr">
                <input
                  type="checkbox"
                  checked={options.shapeFilled}
                  onChange={(e) => dispatch({ type: 'tool/options', patch: { shapeFilled: e.target.checked } })}
                  data-testid="shape-filled"
                />
                Relleno
              </label>
              {!options.shapeFilled ? (
                <label className="statusbar__attr">
                  Trazo
                  <input
                    type="range"
                    min={1}
                    max={8}
                    value={options.outlineWidth}
                    onChange={(e) => dispatch({ type: 'tool/options', patch: { outlineWidth: Number(e.target.value) } })}
                  />
                  <b>{options.outlineWidth}px</b>
                </label>
              ) : null}
            </>
          ) : null}
          {state.tool === 'fill' ? (
            <label className="statusbar__attr">
              Tolerancia
              <input
                type="range"
                min={0}
                max={64}
                value={options.fillTolerance}
                onChange={(e) => dispatch({ type: 'tool/options', patch: { fillTolerance: Number(e.target.value) } })}
                data-testid="fill-tolerance"
              />
              <b>{options.fillTolerance}</b>
            </label>
          ) : null}
          {state.tool === 'shade' ? (
            <label className="statusbar__attr">
              Fuerza
              <input
                type="range"
                min={5}
                max={50}
                value={Math.round(options.shadeStrength * 100)}
                onChange={(e) => dispatch({ type: 'tool/options', patch: { shadeStrength: Number(e.target.value) / 100 } })}
              />
              <b>{Math.round(options.shadeStrength * 100)}%</b>
            </label>
          ) : null}
        </span>
      </span>

      <span className="statusbar__spacer" />

      <span className="statusbar__item" data-testid="status-project">
        {doc.width}x{doc.height} · {doc.layers.length} capa{doc.layers.length !== 1 ? 's' : ''} ·{' '}
        {doc.palette.length} colores
      </span>
      <span className="statusbar__item" data-testid="status-zoom">
        Zoom <b>{state.zoom * 100}%</b>
      </span>
      <span className={`statusbar__item statusbar__ai statusbar__ai--${state.ai.status}`} data-testid="status-ai">
        <span className="dot" />
        {aiStatus}
      </span>
    </footer>
  );
}
