/**
 * Diálogos modales de la aplicación: nuevo proyecto, tamaño de lienzo,
 * edición de color, reemplazo de color, importación de paleta por texto,
 * exportación de paleta y lista de atajos.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useEditor } from '../state/editorStore.tsx';
import { Icon } from './Icons.tsx';
import { ColorPicker } from './ColorPicker.tsx';
import { colorToHexAlpha } from '../core/color.ts';
import { parsePalette, type PaletteFormat } from '../core/palette.ts';
import { createEmptyDoc } from '../core/project.ts';
import {
  exportActiveLayerPng as exportLayerPngAction,
  exportPalette as exportPaletteAction,
  exportPng as exportPngAction,
} from '../utils/projectOps.ts';
import { SHORTCUTS, TOOLS } from '../tools/index.ts';
import type { PaletteColor, ProjectDoc } from '../types/index.ts';

export type DialogId =
  | 'new'
  | 'canvas'
  | 'color-add'
  | 'color-edit'
  | 'replace-color'
  | 'paste-palette'
  | 'export-palette'
  | 'export-png'
  | 'shortcuts'
  | null;

function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} data-testid={testId}>
        <header className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} title="Cerrar">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

function SizeFields({
  width,
  height,
  onWidth,
  onHeight,
}: {
  width: number;
  height: number;
  onWidth: (v: number) => void;
  onHeight: (v: number) => void;
}): JSX.Element {
  return (
    <div className="field-row">
      <label className="field field--narrow">
        <span>Ancho (px)</span>
        <input type="number" min={1} max={256} value={width} onChange={(e) => onWidth(Number(e.target.value))} />
      </label>
      <label className="field field--narrow">
        <span>Alto (px)</span>
        <input type="number" min={1} max={256} value={height} onChange={(e) => onHeight(Number(e.target.value))} />
      </label>
    </div>
  );
}

function ColorEditor({
  initial,
  onSubmit,
  submitLabel,
  testId,
}: {
  initial: PaletteColor;
  onSubmit: (color: PaletteColor) => void;
  submitLabel: string;
  testId?: string;
}): JSX.Element {
  return (
    <ColorPicker
      initial={initial}
      onSubmit={onSubmit}
      submitLabel={submitLabel}
      testId={testId}
    />
  );
}

export function Dialogs({ dialog, onClose }: { dialog: DialogId; onClose: () => void }): JSX.Element | null {
  const { state, dispatch, toast } = useEditor();
  const doc = state.history.present;

  const [width, setWidth] = useState(doc.width);
  const [height, setHeight] = useState(doc.height);
  const [anchor, setAnchor] = useState<'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('center');
  const [replaceFrom, setReplaceFrom] = useState(state.colorIndex);
  const [replaceTo, setReplaceTo] = useState(Math.min(1, doc.palette.length - 1));
  const [replaceScope, setReplaceScope] = useState<'active' | 'all'>('all');
  const [pasteText, setPasteText] = useState('');
  const [pasteMode, setPasteMode] = useState<'replace' | 'append'>('replace');
  const [exportFormat, setExportFormat] = useState<PaletteFormat>('json');
  const [exportScale, setExportScale] = useState(1);
  const [exportLayerOnly, setExportLayerOnly] = useState(false);

  useEffect(() => {
    if (dialog === 'canvas' || dialog === 'new') {
      setWidth(doc.width);
      setHeight(doc.height);
    }
    if (dialog === 'replace-color') {
      setReplaceFrom(state.colorIndex);
      setReplaceTo(Math.min(1, doc.palette.length - 1));
    }
  }, [dialog, doc.width, doc.height, doc.palette.length, state.colorIndex]);

  switch (dialog) {
    case 'new':
      return (
        <Modal title="Nuevo proyecto" onClose={onClose} testId="dialog-new">
          <p className="panel__hint">Se creará un lienzo vacío con una paleta básica.</p>
          <SizeFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
          <div className="btn-row">
            {[8, 16, 32, 64].map((size) => (
              <button
                key={size}
                type="button"
                className="btn btn--tiny"
                onClick={() => {
                  setWidth(size);
                  setHeight(size);
                }}
              >
                {size}x{size}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                dispatch({ type: 'doc/replace', doc: newDocWithSize(width, height, doc) });
                onClose();
                toast(`Proyecto nuevo de ${width}x${height}.`, 'success');
              }}
              data-testid="dialog-new-confirm"
            >
              Crear proyecto
            </button>
          </div>
        </Modal>
      );

    case 'canvas':
      return (
        <Modal title="Tamaño del lienzo" onClose={onClose} testId="dialog-canvas">
          <SizeFields width={width} height={height} onWidth={setWidth} onHeight={setHeight} />
          <label className="field">
            <span>Anclaje del contenido</span>
            <select value={anchor} onChange={(e) => setAnchor(e.target.value as typeof anchor)}>
              <option value="center">Centrado</option>
              <option value="top-left">Superior izquierda</option>
              <option value="top-right">Superior derecha</option>
              <option value="bottom-left">Inferior izquierda</option>
              <option value="bottom-right">Inferior derecha</option>
            </select>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                dispatch({ type: 'canvas/resize', width, height, anchor });
                onClose();
                toast(`Lienzo redimensionado a ${width}x${height}.`, 'success');
              }}
              data-testid="dialog-canvas-confirm"
            >
              Aplicar
            </button>
          </div>
        </Modal>
      );

    case 'color-add':
      return (
        <Modal title="Añadir color" onClose={onClose} testId="dialog-color-add">
          <ColorEditor
            initial={doc.palette[state.colorIndex] ?? { hex: '#ffffff', alpha: 255 }}
            submitLabel="Añadir a la paleta"
            onSubmit={(color) => {
              dispatch({ type: 'palette/add', color });
              onClose();
              toast('Color añadido a la paleta.', 'success');
            }}
          />
        </Modal>
      );

    case 'color-edit':
      return (
        <Modal title="Editar color" onClose={onClose} testId="dialog-color-edit">
          <p className="panel__hint">
            Editar un color cambia todos los píxeles que usan su índice en el documento.
          </p>
          <ColorEditor
            initial={doc.palette[state.colorIndex] ?? { hex: '#ffffff', alpha: 255 }}
            submitLabel="Guardar color"
            onSubmit={(color) => {
              dispatch({ type: 'palette/update', index: state.colorIndex, color });
              onClose();
              toast('Color actualizado.', 'success');
            }}
          />
        </Modal>
      );

    case 'replace-color':
      return (
        <Modal title="Reemplazar color" onClose={onClose} testId="dialog-replace">
          <label className="field">
            <span>Color a reemplazar</span>
            <select value={replaceFrom} onChange={(e) => setReplaceFrom(Number(e.target.value))} data-testid="replace-from">
              {doc.palette.map((c, i) => (
                <option key={i} value={i}>
                  {i}: {colorToHexAlpha(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reemplazar por</span>
            <select value={replaceTo} onChange={(e) => setReplaceTo(Number(e.target.value))} data-testid="replace-to">
              {doc.palette.map((c, i) => (
                <option key={i} value={i}>
                  {i}: {colorToHexAlpha(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ámbito</span>
            <select value={replaceScope} onChange={(e) => setReplaceScope(e.target.value as 'active' | 'all')}>
              <option value="all">Todas las capas</option>
              <option value="active">Solo la capa activa</option>
            </select>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              disabled={replaceFrom === replaceTo}
              onClick={() => {
                dispatch({ type: 'palette/replace', from: replaceFrom, to: replaceTo, scope: replaceScope });
                onClose();
                toast('Color reemplazado.', 'success');
              }}
              data-testid="replace-confirm"
            >
              Reemplazar
            </button>
          </div>
        </Modal>
      );

    case 'paste-palette':
      return (
        <Modal title="Importar paleta desde texto" onClose={onClose} testId="dialog-paste-palette">
          <p className="panel__hint">
            Pega colores en formato JSON (["#ff0000", ...]), lista HEX (un color por línea) o GIMP Palette (GPL).
          </p>
          <textarea
            rows={8}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'#ff0000\n#00ff00\n#0000ff'}
            data-testid="paste-palette-text"
          />
          <label className="field">
            <span>Modo</span>
            <select value={pasteMode} onChange={(e) => setPasteMode(e.target.value as 'replace' | 'append')}>
              <option value="replace">Reemplazar paleta actual</option>
              <option value="append">Añadir a la paleta actual</option>
            </select>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                try {
                  const colors = parsePalette(pasteText);
                  dispatch({ type: 'palette/import', colors, mode: pasteMode });
                  onClose();
                  toast(`Paleta importada (${colors.length} colores).`, 'success');
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
              data-testid="paste-palette-confirm"
            >
              Importar
            </button>
          </div>
        </Modal>
      );

    case 'export-palette':
      return (
        <Modal title="Exportar paleta" onClose={onClose} testId="dialog-export-palette">
          <label className="field">
            <span>Formato</span>
            <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as PaletteFormat)}>
              <option value="json">JSON (["#rrggbb", ...])</option>
              <option value="hex">HEX (una línea por color)</option>
              <option value="gpl">GPL (GIMP Palette)</option>
            </select>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                exportPaletteAction(state, exportFormat, toast);
                onClose();
              }}
              data-testid="export-palette-confirm"
            >
              Exportar
            </button>
          </div>
        </Modal>
      );

    case 'export-png':
      return (
        <Modal title="Exportar PNG" onClose={onClose} testId="dialog-export-png">
          <p className="panel__hint">
            Se exporta el compuesto de las capas visibles con escala de píxeles (sin suavizado).
          </p>
          <label className="field">
            <span>Escala</span>
            <select value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))} data-testid="export-scale">
              <option value={1}>1x (tamaño original)</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
              <option value={8}>8x</option>
            </select>
          </label>
          <label className="field field--inline">
            <input
              type="checkbox"
              checked={exportLayerOnly}
              onChange={(e) => setExportLayerOnly(e.target.checked)}
              data-testid="export-layer-only"
            />
            <span>Exportar solo la capa activa</span>
          </label>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--accent"
              onClick={() => {
                if (exportLayerOnly) exportLayerPngAction(state, exportScale, toast);
                else exportPngAction(state, exportScale, toast);
                onClose();
              }}
              data-testid="export-png-confirm"
            >
              Exportar PNG
            </button>
          </div>
        </Modal>
      );

    case 'shortcuts':
      return (
        <Modal title="Atajos de teclado" onClose={onClose} testId="dialog-shortcuts">
          <table className="shortcuts-table">
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.id}>
                  <td>
                    <kbd>{t.shortcut}</kbd>
                  </td>
                  <td>{t.label}</td>
                </tr>
              ))}
              {SHORTCUTS.map((s) => (
                <tr key={s.keys}>
                  <td>
                    <kbd>{s.keys}</kbd>
                  </td>
                  <td>{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      );

    default:
      return null;
  }
}

/* --------------------- helpers locales al módulo --------------------- */

function newDocWithSize(width: number, height: number, reference: ProjectDoc): ProjectDoc {
  return createEmptyDoc(width, height, reference.palette);
}
