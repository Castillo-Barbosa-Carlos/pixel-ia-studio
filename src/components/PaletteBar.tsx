/**
 * Barra superior de paleta: swatches, color activo/secundario y operaciones
 * sobre la paleta (añadir, editar, eliminar, reemplazar, importar/exportar).
 */
import { colorToCssRgba, colorToHexAlpha, luminance } from '../core/color.ts';
import { useEditor } from '../state/editorStore.tsx';
import { Icon } from './Icons.tsx';

export interface PaletteBarActions {
  onAddColor: () => void;
  onEditColor: () => void;
  onReplaceColor: () => void;
  onImportPalette: (mode: 'replace' | 'append') => void;
  onExportPalette: () => void;
  onPastePalette: () => void;
}

export function PaletteBar({ actions }: { actions: PaletteBarActions }): JSX.Element {
  const { state, dispatch } = useEditor();
  const doc = state.history.present;
  const active = doc.palette[state.colorIndex] ?? doc.palette[0];
  const secondary = doc.palette[state.secondaryIndex] ?? doc.palette[0];

  return (
    <div className="palettebar" data-testid="palette-bar">
      <div className="palettebar__chips">
        <button
          type="button"
          className="chip chip--active"
          title="Color activo (clic para editar)"
          onClick={actions.onEditColor}
          data-testid="active-color"
        >
          <span
            className="chip__swatch"
            style={{ background: colorToCssRgba(active) }}
          />
          <span className="chip__info">
            <span className="chip__hex">{colorToHexAlpha(active)}</span>
            <span className="chip__rgba">
              rgba({parseInt(active.hex.slice(1, 3), 16)}, {parseInt(active.hex.slice(3, 5), 16)},{' '}
              {parseInt(active.hex.slice(5, 7), 16)}, {active.alpha})
            </span>
          </span>
        </button>
        <button
          type="button"
          className="chip"
          title="Color secundario (clic der. sobre un swatch). Clic para editar."
          onClick={() => dispatch({ type: 'color/set', index: state.secondaryIndex })}
          data-testid="secondary-color"
        >
          <span className="chip__swatch chip__swatch--small" style={{ background: colorToCssRgba(secondary) }} />
          <span className="chip__label">Secundario</span>
        </button>
        <button
          type="button"
          className="chip chip--transparent"
          title="Transparencia: activa el borrador"
          onClick={() => dispatch({ type: 'tool/set', tool: 'eraser' })}
          data-testid="transparent-swatch"
        >
          <span className="chip__swatch chip__swatch--small chip__swatch--checker" />
          <span className="chip__label">Transparente</span>
        </button>
      </div>

      <div className="palettebar__swatches" data-testid="palette-swatches">
        {doc.palette.map((color, index) => (
          <button
            key={`${color.hex}-${index}`}
            type="button"
            className={`swatch ${index === state.colorIndex ? 'swatch--primary' : ''} ${
              index === state.secondaryIndex ? 'swatch--secondary' : ''
            }`}
            style={{ background: colorToCssRgba(color), color: luminance(color) > 140 ? '#111' : '#fff' }}
            title={`${colorToHexAlpha(color)} — clic: color activo · clic der.: secundario`}
            onClick={() => dispatch({ type: 'color/set', index })}
            onContextMenu={(e) => {
              e.preventDefault();
              dispatch({ type: 'color/set', index, secondary: true });
            }}
            onDoubleClick={actions.onEditColor}
            data-testid={`swatch-${index}`}
          >
            {index === state.colorIndex ? <Icon name="check" size={10} /> : null}
          </button>
        ))}
      </div>

      <div className="palettebar__actions">
        <button type="button" className="btn btn--icon" title="Añadir color" onClick={actions.onAddColor} data-testid="palette-add">
          <Icon name="plus" />
        </button>
        <button type="button" className="btn btn--icon" title="Editar color activo" onClick={actions.onEditColor} data-testid="palette-edit">
          <Icon name="settings" />
        </button>
        <button type="button" className="btn btn--icon" title="Selector de color (visual y cuentagotas)" onClick={actions.onEditColor} data-testid="palette-picker">
          <Icon name="eyedropper" />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          title="Eliminar color activo (los píxeles pasan a transparentes)"
          onClick={() => dispatch({ type: 'palette/remove', index: state.colorIndex })}
          data-testid="palette-remove"
        >
          <Icon name="trash" />
        </button>
        <button type="button" className="btn btn--icon" title="Reemplazar un color por otro" onClick={actions.onReplaceColor} data-testid="palette-replace">
          <Icon name="refresh" />
        </button>
        <span className="divider" />
        <button type="button" className="btn btn--icon" title="Importar paleta (archivo)" onClick={() => actions.onImportPalette('replace')} data-testid="palette-import">
          <Icon name="folder" />
        </button>
        <button type="button" className="btn btn--icon" title="Importar paleta (pegar texto)" onClick={actions.onPastePalette}>
          <Icon name="copy" />
        </button>
        <button type="button" className="btn btn--icon" title="Exportar paleta (JSON/HEX/GPL)" onClick={actions.onExportPalette} data-testid="palette-export">
          <Icon name="save" />
        </button>
      </div>
    </div>
  );
}
